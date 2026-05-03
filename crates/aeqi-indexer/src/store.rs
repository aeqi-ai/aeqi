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
    (
        "006_watched_addresses",
        r#"
        -- The dispatch source-of-truth for the poll loop. Each round selects
        -- every address here, builds a single Filter spanning all of them, and
        -- runs the topic0 handler on every returned log.
        -- Seeded by main with the factory address; handlers self-register
        -- new addresses (e.g. TrustCreated → register trust as 'trust',
        -- ModuleAdded → register module as 'module') so the next round picks
        -- them up automatically. This is how the indexer scales from 1 contract
        -- to N without recompile.
        CREATE TABLE IF NOT EXISTS watched_addresses (
            address TEXT PRIMARY KEY,
            kind TEXT NOT NULL,           -- 'factory' | 'trust' | 'module'
            registered_block INTEGER NOT NULL
        );
        "#,
    ),
    (
        "007_modules",
        r#"
        -- A module attached to a TRUST. Created via TRUST_ModuleAdded
        -- (bytes32 moduleId, address moduleAddress, uint256 moduleAcl) emitted
        -- by the TRUST contract itself (not Factory). The TRUST is the proxy
        -- and modules are pluggable behavior contracts attached to it.
        --
        -- module_acl is a uint256 bit-flag set; stored as hex (TEXT) since
        -- u256 doesn't fit in SQLite's 64-bit INTEGER reliably.
        CREATE TABLE IF NOT EXISTS modules (
            trust_address TEXT NOT NULL,
            module_id TEXT NOT NULL,
            module_address TEXT NOT NULL,
            module_acl TEXT NOT NULL,
            attached_block INTEGER NOT NULL,
            attached_tx TEXT NOT NULL,
            PRIMARY KEY (trust_address, module_id),
            FOREIGN KEY (trust_address) REFERENCES trusts(address)
        );
        CREATE INDEX IF NOT EXISTS idx_modules_module_address
          ON modules(module_address);
        "#,
    ),
    (
        "008_permissions_events",
        r#"
        -- Audit log of TRUST permissions changes. The TRUST emits three
        -- variants — Granted (set bits), Revoked (clear bits), Set (overwrite).
        -- We persist each as an event row; computing effective flags is the
        -- consumer's job (frontend / GraphQL aggregator). This is simpler
        -- than maintaining a derived "current flags" table that would need
        -- bitwise updates on every event.
        --
        -- entity_id is opaque to the indexer — it's a bytes32 hash that the
        -- TRUST resolves to an agent / role / arbitrary subject internally.
        CREATE TABLE IF NOT EXISTS permissions_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trust_address TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            kind TEXT NOT NULL,         -- 'granted' | 'revoked' | 'set'
            flags TEXT NOT NULL,        -- u256 hex
            block_number INTEGER NOT NULL,
            tx_hash TEXT NOT NULL,
            log_index INTEGER NOT NULL,
            UNIQUE (trust_address, block_number, tx_hash, log_index),
            FOREIGN KEY (trust_address) REFERENCES trusts(address)
        );
        CREATE INDEX IF NOT EXISTS idx_perms_trust_entity
          ON permissions_events(trust_address, entity_id, block_number);
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

    // Auto-subscribe: every newly indexed TRUST is added to watched_addresses,
    // so the next poll round catches its module/role/governance events.
    tx.execute(
        "INSERT OR IGNORE INTO watched_addresses (address, kind, registered_block)
         VALUES (?1, 'trust', ?2)",
        params![trust_address, block_number as i64],
    )?;

    tx.commit()?;
    Ok(())
}

/// Enrich an existing TRUST row with registration metadata
/// (template_id, ipfs_cid, signers_count, value_configs_count).
/// Created via Factory.Factory_TRUSTRegisteredEvent which fires
/// AFTER Factory_TRUSTCreatedEvent in the same transaction.
/// Idempotent: updating with the same values is a no-op.
pub fn update_trust_registered(
    conn: &Connection,
    trust_id: &str,
    template_id: &str,
    ipfs_cid: &str,
    signers_count: u64,
    value_configs_count: u64,
) -> Result<()> {
    conn.execute(
        "UPDATE trusts SET template_id = ?1, ipfs_cid = ?2,
                signers_count = ?3, value_configs_count = ?4
         WHERE trust_id = ?5",
        params![
            template_id,
            ipfs_cid,
            signers_count as i64,
            value_configs_count as i64,
            trust_id
        ],
    )?;
    Ok(())
}

/// Insert a signer authorization for a TRUST.
/// Resolves trust_address from trust_id; no-op if the trust isn't yet known
/// (the corresponding TrustCreated event must already be indexed).
pub fn insert_trust_signer(
    conn: &Connection,
    trust_id: &str,
    address_key: &str,
    signer_address: &str,
    has_signed: bool,
    block_number: u64,
    tx_hash: &str,
) -> Result<()> {
    let trust_address: Option<String> = conn
        .query_row(
            "SELECT address FROM trusts WHERE trust_id = ?1",
            params![trust_id],
            |r| r.get(0),
        )
        .ok();
    let Some(trust_address) = trust_address else {
        tracing::warn!(
            "TRUSTSignerAdded for unknown trust_id {} — skipping (TrustCreated not yet indexed)",
            trust_id
        );
        return Ok(());
    };

    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT OR IGNORE INTO accounts (address, first_seen_block, first_seen_tx) VALUES (?1, ?2, ?3)",
        params![signer_address, block_number as i64, tx_hash],
    )?;
    tx.execute(
        "INSERT OR REPLACE INTO trust_signers
            (trust_address, signer_address, address_key, has_signed, added_block, added_tx)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            trust_address,
            signer_address,
            address_key,
            has_signed as i64,
            block_number as i64,
            tx_hash
        ],
    )?;
    tx.commit()?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct SignerRow {
    pub trust_address: String,
    pub signer_address: String,
    pub address_key: String,
    pub has_signed: bool,
    pub added_block: u64,
    pub added_tx: String,
}

/// Fetch all signers authorized on a TRUST.
pub fn get_trust_signers(conn: &Connection, trust_address: &str) -> Result<Vec<SignerRow>> {
    let mut stmt = conn.prepare(
        "SELECT trust_address, signer_address, address_key, has_signed, added_block, added_tx
         FROM trust_signers WHERE trust_address = ?1
         ORDER BY added_block ASC",
    )?;
    let rows = stmt
        .query_map(params![trust_address], |r| {
            Ok(SignerRow {
                trust_address: r.get(0)?,
                signer_address: r.get(1)?,
                address_key: r.get(2)?,
                has_signed: r.get::<_, i64>(3)? != 0,
                added_block: r.get::<_, i64>(4)? as u64,
                added_tx: r.get(5)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Register a contract address to be watched on subsequent poll rounds.
/// Idempotent: re-registering the same address is a no-op (kind is preserved
/// from the first registration, since the first-seen provenance is what
/// matters for the dispatch routing).
pub fn register_watched_address(
    conn: &Connection,
    address: &str,
    kind: &str,
    registered_block: u64,
) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO watched_addresses (address, kind, registered_block)
         VALUES (?1, ?2, ?3)",
        params![address, kind, registered_block as i64],
    )?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct WatchedAddress {
    pub address: String,
    pub kind: String,
    pub registered_block: u64,
}

/// Fetch all watched addresses. Used by the poll loop each round to build
/// the multi-address log filter.
pub fn list_watched_addresses(conn: &Connection) -> Result<Vec<WatchedAddress>> {
    let mut stmt = conn.prepare(
        "SELECT address, kind, registered_block FROM watched_addresses
         ORDER BY registered_block ASC",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(WatchedAddress {
                address: r.get(0)?,
                kind: r.get(1)?,
                registered_block: r.get::<_, i64>(2)? as u64,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Insert a module attached to a TRUST. Created via TRUST_ModuleAdded.
/// Idempotent on (trust_address, module_id). module_acl is the uint256 bit
/// flags formatted as hex string (e.g. "0x...").
pub fn insert_module(
    conn: &Connection,
    trust_address: &str,
    module_id: &str,
    module_address: &str,
    module_acl: &str,
    attached_block: u64,
    attached_tx: &str,
) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT OR IGNORE INTO accounts (address, first_seen_block, first_seen_tx)
         VALUES (?1, ?2, ?3)",
        params![module_address, attached_block as i64, attached_tx],
    )?;
    tx.execute(
        "INSERT OR REPLACE INTO modules
            (trust_address, module_id, module_address, module_acl, attached_block, attached_tx)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            trust_address,
            module_id,
            module_address,
            module_acl,
            attached_block as i64,
            attached_tx
        ],
    )?;
    // Auto-subscribe the module address so its own events get caught.
    tx.execute(
        "INSERT OR IGNORE INTO watched_addresses (address, kind, registered_block)
         VALUES (?1, 'module', ?2)",
        params![module_address, attached_block as i64],
    )?;
    tx.commit()?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct ModuleRow {
    pub trust_address: String,
    pub module_id: String,
    pub module_address: String,
    pub module_acl: String,
    pub attached_block: u64,
    pub attached_tx: String,
}

/// Fetch all modules attached to a TRUST.
pub fn get_modules_for_trust(conn: &Connection, trust_address: &str) -> Result<Vec<ModuleRow>> {
    let mut stmt = conn.prepare(
        "SELECT trust_address, module_id, module_address, module_acl,
                attached_block, attached_tx
         FROM modules WHERE trust_address = ?1
         ORDER BY attached_block ASC",
    )?;
    let rows = stmt
        .query_map(params![trust_address], |r| {
            Ok(ModuleRow {
                trust_address: r.get(0)?,
                module_id: r.get(1)?,
                module_address: r.get(2)?,
                module_acl: r.get(3)?,
                attached_block: r.get::<_, i64>(4)? as u64,
                attached_tx: r.get(5)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Identifying coordinates for a single emitted log — block + tx + log index.
/// Used as the idempotency key when persisting per-event audit rows.
#[derive(Debug, Clone, Copy)]
pub struct LogCoord<'a> {
    pub block_number: u64,
    pub tx_hash: &'a str,
    pub log_index: u64,
}

/// Insert a row in the permissions audit log. UNIQUE on
/// (trust_address, block_number, tx_hash, log_index) makes this idempotent
/// across reorg-recovery replays.
pub fn insert_permissions_event(
    conn: &Connection,
    trust_address: &str,
    entity_id: &str,
    kind: &str,
    flags: &str,
    coord: LogCoord<'_>,
) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO permissions_events
            (trust_address, entity_id, kind, flags, block_number, tx_hash, log_index)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            trust_address,
            entity_id,
            kind,
            flags,
            coord.block_number as i64,
            coord.tx_hash,
            coord.log_index as i64
        ],
    )?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct PermissionsEventRow {
    pub trust_address: String,
    pub entity_id: String,
    pub kind: String,
    pub flags: String,
    pub block_number: u64,
    pub tx_hash: String,
    pub log_index: u64,
}

/// Audit log of permissions events for an entity within a TRUST, oldest first.
pub fn get_permissions_events(
    conn: &Connection,
    trust_address: &str,
    entity_id: &str,
) -> Result<Vec<PermissionsEventRow>> {
    let mut stmt = conn.prepare(
        "SELECT trust_address, entity_id, kind, flags, block_number, tx_hash, log_index
         FROM permissions_events
         WHERE trust_address = ?1 AND entity_id = ?2
         ORDER BY block_number ASC, log_index ASC",
    )?;
    let rows = stmt
        .query_map(params![trust_address, entity_id], |r| {
            Ok(PermissionsEventRow {
                trust_address: r.get(0)?,
                entity_id: r.get(1)?,
                kind: r.get(2)?,
                flags: r.get(3)?,
                block_number: r.get::<_, i64>(4)? as u64,
                tx_hash: r.get(5)?,
                log_index: r.get::<_, i64>(6)? as u64,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
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
    fn update_trust_registered_enriches_existing_row() {
        let dir = tempdir().unwrap();
        let conn = open(dir.path().join("test.db")).expect("open");

        let trust_addr = "0x9131b1DEC7d1fE791C599E9D0b94D6414cae0747";
        let trust_id = "0x0000000000000000000000000000000000000000000000000000000000000001";
        let creator = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

        insert_trust_created(&conn, trust_addr, trust_id, creator, 42, "0xabc")
            .expect("create");
        update_trust_registered(
            &conn,
            trust_id,
            "0xtemplate0001",
            "QmIPFSCID",
            3,
            5,
        )
        .expect("register");

        let row = get_trust(&conn, trust_addr).expect("query").expect("row");
        assert_eq!(row.template_id.as_deref(), Some("0xtemplate0001"));
        assert_eq!(row.ipfs_cid.as_deref(), Some("QmIPFSCID"));
        assert_eq!(row.signers_count, Some(3));
        assert_eq!(row.value_configs_count, Some(5));
    }

    #[test]
    fn insert_trust_signer_round_trip() {
        let dir = tempdir().unwrap();
        let conn = open(dir.path().join("test.db")).expect("open");

        let trust_addr = "0x9131b1DEC7d1fE791C599E9D0b94D6414cae0747";
        let trust_id = "0x0000000000000000000000000000000000000000000000000000000000000001";
        let creator = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
        let signer = "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720";
        let address_key = "0x000000000000000000000000a0ee7a142d267c1f36714e4a8f75612f20a79720";

        insert_trust_created(&conn, trust_addr, trust_id, creator, 42, "0xtx1")
            .expect("create");
        insert_trust_signer(&conn, trust_id, address_key, signer, true, 43, "0xtx2")
            .expect("signer");

        let signers = get_trust_signers(&conn, trust_addr).expect("query");
        assert_eq!(signers.len(), 1);
        assert_eq!(signers[0].signer_address, signer);
        assert_eq!(signers[0].address_key, address_key);
        assert!(signers[0].has_signed);
    }

    #[test]
    fn insert_trust_signer_for_unknown_trust_skips_silently() {
        let dir = tempdir().unwrap();
        let conn = open(dir.path().join("test.db")).expect("open");

        let unknown_trust_id =
            "0x0000000000000000000000000000000000000000000000000000000000000099";
        let signer = "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720";

        insert_trust_signer(&conn, unknown_trust_id, "0xkey", signer, true, 43, "0xtx")
            .expect("should not error");

        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM trust_signers", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn watched_addresses_register_and_list() {
        let dir = tempdir().unwrap();
        let conn = open(dir.path().join("test.db")).expect("open");

        register_watched_address(&conn, "0xfactory", "factory", 10).unwrap();
        register_watched_address(&conn, "0xtrust1", "trust", 20).unwrap();
        // Idempotent: re-register same address is a no-op
        register_watched_address(&conn, "0xtrust1", "trust", 20).unwrap();

        let watched = list_watched_addresses(&conn).unwrap();
        assert_eq!(watched.len(), 2);
        assert_eq!(watched[0].address, "0xfactory");
        assert_eq!(watched[0].kind, "factory");
        assert_eq!(watched[1].address, "0xtrust1");
        assert_eq!(watched[1].kind, "trust");
    }

    #[test]
    fn insert_trust_created_auto_subscribes() {
        let dir = tempdir().unwrap();
        let conn = open(dir.path().join("test.db")).expect("open");

        let trust_addr = "0x9131b1DEC7d1fE791C599E9D0b94D6414cae0747";
        let trust_id = "0x0000000000000000000000000000000000000000000000000000000000000001";
        let creator = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

        insert_trust_created(&conn, trust_addr, trust_id, creator, 42, "0xabc").unwrap();

        // The TRUST should now be in watched_addresses with kind='trust'
        let watched = list_watched_addresses(&conn).unwrap();
        let trust_watch = watched
            .iter()
            .find(|w| w.address == trust_addr)
            .expect("trust auto-registered");
        assert_eq!(trust_watch.kind, "trust");
        assert_eq!(trust_watch.registered_block, 42);
    }

    #[test]
    fn module_round_trip() {
        let dir = tempdir().unwrap();
        let conn = open(dir.path().join("test.db")).expect("open");

        let trust_addr = "0x9131b1DEC7d1fE791C599E9D0b94D6414cae0747";
        let trust_id = "0x0000000000000000000000000000000000000000000000000000000000000001";
        let creator = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
        let module_id = "0x000000000000000000000000000000000000000000000000000000000000abcd";
        let module_addr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
        let module_acl = "0x000000000000000000000000000000000000000000000000000000000000000f";

        insert_trust_created(&conn, trust_addr, trust_id, creator, 42, "0xtx1").unwrap();
        insert_module(&conn, trust_addr, module_id, module_addr, module_acl, 43, "0xtx2")
            .unwrap();

        let modules = get_modules_for_trust(&conn, trust_addr).unwrap();
        assert_eq!(modules.len(), 1);
        assert_eq!(modules[0].module_id, module_id);
        assert_eq!(modules[0].module_address, module_addr);
        assert_eq!(modules[0].module_acl, module_acl);
        assert_eq!(modules[0].attached_block, 43);

        // The module address is also auto-subscribed
        let watched = list_watched_addresses(&conn).unwrap();
        let module_watch = watched
            .iter()
            .find(|w| w.address == module_addr)
            .expect("module auto-watched");
        assert_eq!(module_watch.kind, "module");

        // Idempotent: re-insert same module is a no-op (still 1 row)
        insert_module(&conn, trust_addr, module_id, module_addr, module_acl, 43, "0xtx2")
            .unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM modules", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn permissions_events_audit_log_round_trip() {
        let dir = tempdir().unwrap();
        let conn = open(dir.path().join("test.db")).expect("open");

        let trust_addr = "0x9131b1DEC7d1fE791C599E9D0b94D6414cae0747";
        let trust_id = "0x0000000000000000000000000000000000000000000000000000000000000001";
        let creator = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
        let entity = "0x000000000000000000000000000000000000000000000000000000000000beef";

        insert_trust_created(&conn, trust_addr, trust_id, creator, 42, "0xtx0").unwrap();

        // Granted then Revoked then Set
        let c1 = LogCoord { block_number: 50, tx_hash: "0xtx1", log_index: 0 };
        let c2 = LogCoord { block_number: 51, tx_hash: "0xtx2", log_index: 0 };
        let c3 = LogCoord { block_number: 52, tx_hash: "0xtx3", log_index: 0 };
        insert_permissions_event(&conn, trust_addr, entity, "granted", "0x3", c1).unwrap();
        insert_permissions_event(&conn, trust_addr, entity, "revoked", "0x1", c2).unwrap();
        insert_permissions_event(&conn, trust_addr, entity, "set", "0xff", c3).unwrap();

        let events = get_permissions_events(&conn, trust_addr, entity).unwrap();
        assert_eq!(events.len(), 3);
        assert_eq!(events[0].kind, "granted");
        assert_eq!(events[0].flags, "0x3");
        assert_eq!(events[1].kind, "revoked");
        assert_eq!(events[2].kind, "set");
        assert_eq!(events[2].flags, "0xff");

        // Idempotent: re-insert same event is a no-op
        insert_permissions_event(&conn, trust_addr, entity, "set", "0xff", c3).unwrap();
        let events = get_permissions_events(&conn, trust_addr, entity).unwrap();
        assert_eq!(events.len(), 3);
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
