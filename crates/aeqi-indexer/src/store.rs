//! Storage layer: SQLite via rusqlite.
//!
//! Schema migrations are additive-only. Each entity gets a numbered .sql file.
//! The migrator is idempotent: it tracks applied migration IDs in a meta table
//! and re-runs only what's new.

use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use std::path::Path;

/// All schema migrations in order. Add new entries; never remove or reorder.
const MIGRATIONS: &[(&str, &str)] = &[
    (
        "001_meta",
        r#"
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id TEXT PRIMARY KEY,
            applied_at INTEGER NOT NULL
        );
        "#,
    ),
    (
        "002_committed_blocks",
        r#"
        -- Tracks which blocks the indexer has fully processed. Used for reorg
        -- detection: on every new block, the parent_hash must match the most
        -- recent committed block_hash.
        CREATE TABLE IF NOT EXISTS committed_blocks (
            block_number INTEGER PRIMARY KEY,
            block_hash TEXT NOT NULL,
            parent_hash TEXT NOT NULL,
            committed_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_committed_blocks_hash
          ON committed_blocks(block_hash);
        "#,
    ),
    (
        "003_accounts",
        r#"
        -- The Account fan-in primitive — every address that appears in any event
        -- gets a row here. Specialized tables (trusts, modules, etc.) FK to this.
        CREATE TABLE IF NOT EXISTS accounts (
            address TEXT PRIMARY KEY,
            first_seen_block INTEGER NOT NULL,
            first_seen_tx TEXT NOT NULL
        );
        "#,
    ),
    (
        "004_trusts",
        r#"
        -- A deployed TRUST contract. Created via Factory.Factory_TRUSTCreatedEvent.
        CREATE TABLE IF NOT EXISTS trusts (
            address TEXT PRIMARY KEY,
            trust_id TEXT NOT NULL UNIQUE,
            creator_address TEXT NOT NULL,
            template_id TEXT,
            ipfs_cid TEXT,
            signers_count INTEGER,
            value_configs_count INTEGER,
            created_block INTEGER NOT NULL,
            created_tx TEXT NOT NULL,
            FOREIGN KEY (creator_address) REFERENCES accounts(address),
            FOREIGN KEY (address) REFERENCES accounts(address)
        );
        CREATE INDEX IF NOT EXISTS idx_trusts_creator ON trusts(creator_address);
        CREATE INDEX IF NOT EXISTS idx_trusts_template ON trusts(template_id);
        "#,
    ),
    (
        "005_trust_signers",
        r#"
        -- Authorized signers for a TRUST. Many-to-many (trust × signer).
        CREATE TABLE IF NOT EXISTS trust_signers (
            trust_address TEXT NOT NULL,
            signer_address TEXT NOT NULL,
            address_key TEXT NOT NULL,
            has_signed INTEGER NOT NULL DEFAULT 0,
            added_block INTEGER NOT NULL,
            added_tx TEXT NOT NULL,
            PRIMARY KEY (trust_address, signer_address),
            FOREIGN KEY (trust_address) REFERENCES trusts(address),
            FOREIGN KEY (signer_address) REFERENCES accounts(address)
        );
        "#,
    ),
];

/// Open the SQLite database, applying any pending migrations.
pub fn open<P: AsRef<Path>>(path: P) -> Result<Connection> {
    let conn = Connection::open(path).context("open sqlite")?;
    apply_migrations(&conn)?;
    Ok(conn)
}

/// Apply any migrations not yet recorded in `schema_migrations`.
fn apply_migrations(conn: &Connection) -> Result<()> {
    // Always run the meta migration first (it's idempotent — IF NOT EXISTS).
    for (id, sql) in MIGRATIONS {
        if id == &"001_meta" {
            conn.execute_batch(sql)
                .with_context(|| format!("apply migration {}", id))?;
        }
    }

    for (id, sql) in MIGRATIONS {
        let already: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if already > 0 {
            continue;
        }
        conn.execute_batch(sql)
            .with_context(|| format!("apply migration {}", id))?;
        conn.execute(
            "INSERT INTO schema_migrations (id, applied_at) VALUES (?1, ?2)",
            params![
                id,
                chrono::Utc::now().timestamp()
            ],
        )?;
        tracing::info!("applied migration: {}", id);
    }
    Ok(())
}

/// Insert a new TRUST row + the corresponding accounts entries.
/// Idempotent: re-applying the same TRUST creation is a no-op.
pub fn insert_trust_created(
    conn: &Connection,
    trust_address: &str,
    trust_id: &str,
    creator_address: &str,
    block_number: u64,
    tx_hash: &str,
) -> Result<()> {
    let tx = conn.unchecked_transaction()?;

    // Upsert accounts
    tx.execute(
        "INSERT OR IGNORE INTO accounts (address, first_seen_block, first_seen_tx) VALUES (?1, ?2, ?3)",
        params![trust_address, block_number as i64, tx_hash],
    )?;
    tx.execute(
        "INSERT OR IGNORE INTO accounts (address, first_seen_block, first_seen_tx) VALUES (?1, ?2, ?3)",
        params![creator_address, block_number as i64, tx_hash],
    )?;

    // Upsert trust (no-op if address already present)
    tx.execute(
        "INSERT OR IGNORE INTO trusts (address, trust_id, creator_address, created_block, created_tx) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![trust_address, trust_id, creator_address, block_number as i64, tx_hash],
    )?;

    tx.commit()?;
    Ok(())
}

/// Look up a TRUST by its on-chain address.
pub fn get_trust(conn: &Connection, address: &str) -> Result<Option<TrustRow>> {
    let row = conn
        .query_row(
            "SELECT address, trust_id, creator_address, template_id, ipfs_cid,
                    signers_count, value_configs_count, created_block, created_tx
             FROM trusts WHERE address = ?1",
            params![address],
            |r| {
                Ok(TrustRow {
                    address: r.get(0)?,
                    trust_id: r.get(1)?,
                    creator_address: r.get(2)?,
                    template_id: r.get(3)?,
                    ipfs_cid: r.get(4)?,
                    signers_count: r.get(5)?,
                    value_configs_count: r.get(6)?,
                    created_block: r.get::<_, i64>(7)? as u64,
                    created_tx: r.get(8)?,
                })
            },
        )
        .ok();
    Ok(row)
}

#[derive(Debug, Clone)]
pub struct TrustRow {
    pub address: String,
    pub trust_id: String,
    pub creator_address: String,
    pub template_id: Option<String>,
    pub ipfs_cid: Option<String>,
    pub signers_count: Option<i64>,
    pub value_configs_count: Option<i64>,
    pub created_block: u64,
    pub created_tx: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn migrations_are_idempotent_and_applied_in_order() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("test.db");

        // First open: applies all migrations
        let conn1 = open(&path).expect("first open");
        let count1: i64 = conn1
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count1, MIGRATIONS.len() as i64);
        drop(conn1);

        // Second open: no-op (migrations already recorded)
        let conn2 = open(&path).expect("second open");
        let count2: i64 = conn2
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count2, MIGRATIONS.len() as i64);
    }

    #[test]
    fn round_trip_trust_creation() {
        let dir = tempdir().unwrap();
        let conn = open(dir.path().join("test.db")).expect("open");

        let trust_addr = "0x9131b1DEC7d1fE791C599E9D0b94D6414cae0747";
        let trust_id = "0x0000000000000000000000000000000000000000000000000000000000000001";
        let creator = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

        insert_trust_created(&conn, trust_addr, trust_id, creator, 42, "0xabc")
            .expect("insert");

        let row = get_trust(&conn, trust_addr)
            .expect("query")
            .expect("row exists");

        assert_eq!(row.address, trust_addr);
        assert_eq!(row.trust_id, trust_id);
        assert_eq!(row.creator_address, creator);
        assert_eq!(row.created_block, 42);

        // Idempotency: insert again, count stays the same
        insert_trust_created(&conn, trust_addr, trust_id, creator, 42, "0xabc")
            .expect("re-insert");

        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM trusts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }
}
