//! SQLite event sink for aeqi-indexer.
//!
//! Schema (v3):
//! - `events` — one row per decoded Anchor event. Idempotent on
//!   (signature, program, event_type, log_index) so replays + reorgs
//!   don't double-count, while still allowing multiple events of the
//!   same type within a single transaction (e.g. several
//!   `ModuleRegistered` during a TRUST genesis that wires Role +
//!   Token + Governance modules). Always written — typed decode is
//!   best-effort and additive.
//! - `trust_events` / `module_events` / `acl_events` /
//!   `governance_events` / `capital_events` / `feed_events` — Graph-era
//!   typed projections per the brief in quest 67-162.7. Anchor's
//!   `#[event]` Borsh payload is decoded into family-level rows so
//!   downstream consumers can read TRUST creation, module installs,
//!   ACL changes, proposal lifecycle, capital flows and oracle/NAV
//!   updates as structured columns instead of opaque base64 blobs.
//!   Same (signature, log_index) idempotency as the raw `events` table.
//! - `cursor` — last processed slot per program. Resumed at startup so
//!   the indexer can re-attach to a public RPC and skip-ahead-or-replay
//!   accordingly.
//!
//! Schema is forward-compat: new event types only need their decoder;
//! the generic blob column holds the raw borsh payload for clients that
//! want to decode lazily, and the typed tables are additive.
//!
//! v1 → v2 migration runs automatically on startup. v1's
//! `UNIQUE(signature, program, event_type)` collapsed multiple
//! same-type events emitted in one transaction (quest 67-162.6); v2
//! adds `log_index` (the event's ordinal position in the tx log
//! stream) to the unique key.
//!
//! v2 → v3 is purely additive — the typed projection tables are
//! `CREATE TABLE IF NOT EXISTS` so an existing v2 store inherits them
//! on the next startup without touching pre-existing data.

use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::Mutex;

use crate::events::{
    self, AclEvent, CapitalEvent, FeedEvent, GovernanceEvent, ModuleEvent, TrustEvent, TypedEvent,
};

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    program       TEXT NOT NULL,
    event_type    TEXT NOT NULL,
    slot          INTEGER NOT NULL,
    signature     TEXT NOT NULL,
    log_index     INTEGER NOT NULL DEFAULT 0,
    payload_b64   TEXT NOT NULL,
    created_at    INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    UNIQUE(signature, program, event_type, log_index)
);

CREATE INDEX IF NOT EXISTS events_program_slot_idx ON events(program, slot);
CREATE INDEX IF NOT EXISTS events_signature_idx ON events(signature);

CREATE TABLE IF NOT EXISTS cursor (
    program       TEXT PRIMARY KEY,
    last_slot     INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Typed projections (v3, additive).
--
-- One row per *typed* decoded event, alongside the raw `events` row.
-- All pubkey-shaped columns store base58 strings (the on-wire format
-- the rest of the platform uses); ids that are arbitrary [u8; 32] hashes
-- (module_id, role_id, proposal_id, ...) store base58 as well so the
-- column type is uniform across both. Numeric fields are stored at the
-- widest SQLite-friendly precision (i64); the few u64 / u128 fields the
-- programs emit fit comfortably for our current accounting (treasury
-- amounts are USDC 6-decimals, NAV is u64, governance vote weights are
-- bounded by total supply). If we ever need full u128 fidelity we'll
-- migrate the column to TEXT.

CREATE TABLE IF NOT EXISTS trust_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    trust         TEXT NOT NULL,
    trust_id      TEXT NOT NULL,
    authority     TEXT NOT NULL,
    kind          TEXT NOT NULL,
    slot          INTEGER NOT NULL,
    signature     TEXT NOT NULL,
    log_index     INTEGER NOT NULL,
    created_at    INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    UNIQUE(signature, log_index)
);
CREATE INDEX IF NOT EXISTS trust_events_trust_slot_idx ON trust_events(trust, slot);

CREATE TABLE IF NOT EXISTS module_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    trust         TEXT NOT NULL,
    module_id     TEXT NOT NULL,
    program_id    TEXT NOT NULL,
    provider      TEXT NOT NULL,
    implementation_version INTEGER NOT NULL,
    implementation_metadata_hash TEXT NOT NULL,
    trust_acl     INTEGER NOT NULL,
    kind          TEXT NOT NULL,
    slot          INTEGER NOT NULL,
    signature     TEXT NOT NULL,
    log_index     INTEGER NOT NULL,
    created_at    INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    UNIQUE(signature, log_index)
);
CREATE INDEX IF NOT EXISTS module_events_trust_module_idx ON module_events(trust, module_id);

CREATE TABLE IF NOT EXISTS acl_events (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    trust              TEXT NOT NULL,
    source_module_id   TEXT NOT NULL,
    target_module_id   TEXT NOT NULL,
    flags              INTEGER NOT NULL,
    kind               TEXT NOT NULL,
    slot               INTEGER NOT NULL,
    signature          TEXT NOT NULL,
    log_index          INTEGER NOT NULL,
    created_at         INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    UNIQUE(signature, log_index)
);
CREATE INDEX IF NOT EXISTS acl_events_trust_idx ON acl_events(trust);

CREATE TABLE IF NOT EXISTS governance_events (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    trust                TEXT NOT NULL,
    proposal_id          TEXT NOT NULL,
    governance_config_id TEXT NOT NULL,
    proposer             TEXT NOT NULL,
    vote_start           INTEGER NOT NULL,
    vote_duration        INTEGER NOT NULL,
    kind                 TEXT NOT NULL,
    slot                 INTEGER NOT NULL,
    signature            TEXT NOT NULL,
    log_index            INTEGER NOT NULL,
    created_at           INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    UNIQUE(signature, log_index)
);
CREATE INDEX IF NOT EXISTS governance_events_proposal_idx ON governance_events(proposal_id);

CREATE TABLE IF NOT EXISTS capital_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    trust         TEXT NOT NULL,
    -- Counterparty token account (depositor for deposits,
    -- recipient for withdraws). Same column for both flows so the
    -- table stays normalized.
    counterparty TEXT NOT NULL,
    amount        INTEGER NOT NULL,
    kind          TEXT NOT NULL,
    slot          INTEGER NOT NULL,
    signature     TEXT NOT NULL,
    log_index     INTEGER NOT NULL,
    created_at    INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    UNIQUE(signature, log_index)
);
CREATE INDEX IF NOT EXISTS capital_events_trust_kind_idx ON capital_events(trust, kind);

CREATE TABLE IF NOT EXISTS feed_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    trust           TEXT NOT NULL,
    -- The subject of the feed — a fund_id today, a Pyth feed_pda later.
    feed_subject    TEXT NOT NULL,
    -- Primary value the feed publishes (gross NAV today; price-times-expo
    -- when Pyth backs us). Stored as i64; consumers reading micro-USD
    -- amounts get more than enough range.
    value           INTEGER NOT NULL,
    -- Optional secondary scalars (high-water-mark / accrued-carry for
    -- NAV; could be confidence interval for Pyth). NULL when unused.
    aux_a           INTEGER,
    aux_b           INTEGER,
    kind            TEXT NOT NULL,
    slot            INTEGER NOT NULL,
    signature       TEXT NOT NULL,
    log_index       INTEGER NOT NULL,
    created_at      INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    UNIQUE(signature, log_index)
);
CREATE INDEX IF NOT EXISTS feed_events_subject_slot_idx ON feed_events(feed_subject, slot);
"#;

/// Connection wrapped in Mutex so `Arc<Sink>` is `Send + Sync` for the
/// per-program tokio::spawn'd subscription tasks. Lock scope is tight
/// (one SQL statement per acquire) so contention is minimal.
pub struct Sink {
    conn: Mutex<Connection>,
}

impl Sink {
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self> {
        let conn = Connection::open(&path)
            .with_context(|| format!("opening sqlite at {:?}", path.as_ref()))?;

        // Migrate v1 → v2 BEFORE applying the v2 schema. The v1 events
        // table has no `log_index` column and carries a UNIQUE
        // constraint we need to replace. SQLite can't ALTER a
        // table-level UNIQUE in place; the canonical migration is
        // rename + create new + copy + drop old.
        migrate_v1_to_v2(&conn).context("running v1→v2 events table migration")?;

        conn.execute_batch(SCHEMA).context("applying sqlite schema")?;
        conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA temp_store = MEMORY;
            "#,
        )
        .context("applying sqlite pragmas")?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn record_event(
        &self,
        program: &str,
        event_type: &str,
        slot: u64,
        signature: &str,
        log_index: u32,
        payload_b64: &str,
    ) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let changed = conn.execute(
            r#"INSERT OR IGNORE INTO events(program, event_type, slot, signature, log_index, payload_b64)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6)"#,
            params![program, event_type, slot as i64, signature, log_index as i64, payload_b64],
        )?;
        Ok(changed > 0)
    }

    pub fn bump_cursor(&self, program: &str, slot: u64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            r#"INSERT INTO cursor(program, last_slot) VALUES (?1, ?2)
               ON CONFLICT(program) DO UPDATE SET
                 last_slot = MAX(cursor.last_slot, excluded.last_slot),
                 updated_at = strftime('%s', 'now')"#,
            params![program, slot as i64],
        )?;
        Ok(())
    }

    pub fn cursor(&self, program: &str) -> Result<Option<u64>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT last_slot FROM cursor WHERE program = ?1")?;
        let row: Option<i64> = stmt.query_row(params![program], |r| r.get(0)).ok();
        Ok(row.map(|v| v as u64))
    }

    pub fn event_count(&self) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        Ok(conn.query_row("SELECT COUNT(*) FROM events", [], |r| r.get(0))?)
    }

    /// Project a typed event into the appropriate family table. Best-effort
    /// and additive: callers always insert the raw row first, then call this
    /// to land structured fields alongside. INSERT OR IGNORE keeps the
    /// operation idempotent for replays + reorgs.
    pub fn record_typed(
        &self,
        event: &TypedEvent,
        slot: u64,
        signature: &str,
        log_index: u32,
    ) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let kind = events::family_kind(event);
        let slot_i = slot as i64;
        let log_i = log_index as i64;

        let changed = match event {
            TypedEvent::Trust(TrustEvent::Initialized(e)) => conn.execute(
                r#"INSERT OR IGNORE INTO trust_events
                     (trust, trust_id, authority, kind, slot, signature, log_index)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"#,
                params![
                    events::b58(&e.trust),
                    events::b58(&e.trust_id),
                    events::b58(&e.authority),
                    kind,
                    slot_i,
                    signature,
                    log_i,
                ],
            )?,
            TypedEvent::Module(ModuleEvent::Registered(e)) => conn.execute(
                r#"INSERT OR IGNORE INTO module_events
                     (trust, module_id, program_id, provider,
                      implementation_version, implementation_metadata_hash,
                      trust_acl, kind, slot, signature, log_index)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)"#,
                params![
                    events::b58(&e.trust),
                    events::b58(&e.module_id),
                    events::b58(&e.program_id),
                    events::b58(&e.provider),
                    e.implementation_version as i64,
                    events::b58(&e.implementation_metadata_hash),
                    e.trust_acl as i64,
                    kind,
                    slot_i,
                    signature,
                    log_i,
                ],
            )?,
            TypedEvent::Acl(AclEvent::Set(e)) => conn.execute(
                r#"INSERT OR IGNORE INTO acl_events
                     (trust, source_module_id, target_module_id, flags,
                      kind, slot, signature, log_index)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"#,
                params![
                    events::b58(&e.trust),
                    events::b58(&e.source_module_id),
                    events::b58(&e.target_module_id),
                    e.flags as i64,
                    kind,
                    slot_i,
                    signature,
                    log_i,
                ],
            )?,
            TypedEvent::Governance(GovernanceEvent::ProposalCreated(e)) => conn.execute(
                r#"INSERT OR IGNORE INTO governance_events
                     (trust, proposal_id, governance_config_id, proposer,
                      vote_start, vote_duration, kind, slot, signature, log_index)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"#,
                params![
                    events::b58(&e.trust),
                    events::b58(&e.proposal_id),
                    events::b58(&e.governance_config_id),
                    events::b58(&e.proposer),
                    e.vote_start,
                    e.vote_duration,
                    kind,
                    slot_i,
                    signature,
                    log_i,
                ],
            )?,
            TypedEvent::Capital(CapitalEvent::Deposit(e)) => conn.execute(
                r#"INSERT OR IGNORE INTO capital_events
                     (trust, counterparty, amount, kind, slot, signature, log_index)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"#,
                params![
                    events::b58(&e.trust),
                    events::b58(&e.depositor_ta),
                    e.amount as i64,
                    kind,
                    slot_i,
                    signature,
                    log_i,
                ],
            )?,
            TypedEvent::Feed(FeedEvent::NavUpdated(e)) => conn.execute(
                r#"INSERT OR IGNORE INTO feed_events
                     (trust, feed_subject, value, aux_a, aux_b,
                      kind, slot, signature, log_index)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"#,
                params![
                    events::b58(&e.trust),
                    events::b58(&e.fund_id),
                    e.gross_nav as i64,
                    e.high_water_mark as i64,
                    e.accrued_carry as i64,
                    kind,
                    slot_i,
                    signature,
                    log_i,
                ],
            )?,
        };
        Ok(changed > 0)
    }

    /// Family counts — exposed for tests + ops introspection. Returns one
    /// row per family table in a fixed order. `dead_code` allowed because
    /// the binary doesn't surface counts today, but tests + future ops
    /// tooling read it.
    #[allow(dead_code)]
    pub fn typed_counts(&self) -> Result<TypedCounts> {
        let conn = self.conn.lock().unwrap();
        let q = |table: &str| -> Result<i64> {
            Ok(conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))?)
        };
        Ok(TypedCounts {
            trust: q("trust_events")?,
            module: q("module_events")?,
            acl: q("acl_events")?,
            governance: q("governance_events")?,
            capital: q("capital_events")?,
            feed: q("feed_events")?,
        })
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TypedCounts {
    pub trust: i64,
    pub module: i64,
    pub acl: i64,
    pub governance: i64,
    pub capital: i64,
    pub feed: i64,
}

/// v1 → v2 migration. v1 events table lacks `log_index` and has the
/// old UNIQUE shape; v2 adds the column and extends the unique key.
///
/// Detection: a v1 table will return zero rows from
/// `PRAGMA table_info(events)` for `log_index`. A v2 table (or a
/// freshly-created table — `CREATE TABLE IF NOT EXISTS` won't fire
/// because the v1 table exists) returns one row. No table at all
/// returns zero rows from `PRAGMA table_info(events)` (the table
/// doesn't exist yet) AND the SCHEMA application below will create
/// the v2 shape directly — no migration needed.
fn migrate_v1_to_v2(conn: &Connection) -> Result<()> {
    let table_exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='events'",
        [],
        |r| r.get(0),
    )?;
    if table_exists == 0 {
        return Ok(()); // fresh db; v2 schema will land below
    }

    let has_log_index: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('events') WHERE name='log_index'",
        [],
        |r| r.get(0),
    )?;
    if has_log_index == 1 {
        return Ok(()); // already v2
    }

    // v1 detected. Rename + recreate + copy + drop old.
    conn.execute_batch(
        r#"
        BEGIN;
        ALTER TABLE events RENAME TO events_v1;
        CREATE TABLE events (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            program       TEXT NOT NULL,
            event_type    TEXT NOT NULL,
            slot          INTEGER NOT NULL,
            signature     TEXT NOT NULL,
            log_index     INTEGER NOT NULL DEFAULT 0,
            payload_b64   TEXT NOT NULL,
            created_at    INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            UNIQUE(signature, program, event_type, log_index)
        );
        INSERT INTO events(id, program, event_type, slot, signature, log_index, payload_b64, created_at)
          SELECT id, program, event_type, slot, signature, 0, payload_b64, created_at
          FROM events_v1;
        DROP TABLE events_v1;
        COMMIT;
        "#,
    )
    .context("migrating events_v1 → events")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_and_idempotency() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let sink = Sink::open(&path).unwrap();

        let inserted =
            sink.record_event("aeqi_trust", "TrustInitialized", 100, "sigA", 0, "b64A").unwrap();
        assert!(inserted);

        // Replay — same tuple (including log_index) should be a no-op.
        let inserted_again =
            sink.record_event("aeqi_trust", "TrustInitialized", 100, "sigA", 0, "b64A").unwrap();
        assert!(!inserted_again);

        // Different event_type with same sig is allowed (one tx can emit
        // multiple events).
        let other =
            sink.record_event("aeqi_trust", "ModuleRegistered", 100, "sigA", 0, "b64B").unwrap();
        assert!(other);

        assert_eq!(sink.event_count().unwrap(), 2);
    }

    #[test]
    fn same_type_multiple_logs_in_one_tx() {
        // Quest 67-162.6 regression: a TRUST genesis tx that wires
        // multiple modules emits several `ModuleRegistered` events.
        // v1's UNIQUE(signature, program, event_type) collapsed them
        // into one row; v2's log_index lets each land.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let sink = Sink::open(&path).unwrap();

        for (i, payload) in ["payloadRole", "payloadToken", "payloadGov"].iter().enumerate() {
            let inserted = sink
                .record_event(
                    "aeqi_factory",
                    "ModuleRegistered",
                    200,
                    "sigGenesis",
                    i as u32,
                    payload,
                )
                .unwrap();
            assert!(inserted, "log_index {i} should insert");
        }
        assert_eq!(sink.event_count().unwrap(), 3);

        // Replay the same three: all dedup.
        for (i, payload) in ["payloadRole", "payloadToken", "payloadGov"].iter().enumerate() {
            let inserted = sink
                .record_event(
                    "aeqi_factory",
                    "ModuleRegistered",
                    200,
                    "sigGenesis",
                    i as u32,
                    payload,
                )
                .unwrap();
            assert!(!inserted, "log_index {i} replay should dedup");
        }
        assert_eq!(sink.event_count().unwrap(), 3);
    }

    #[test]
    fn v1_to_v2_migration() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");

        // Hand-construct a v1 db, populate, close.
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                r#"
                CREATE TABLE events (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    program       TEXT NOT NULL,
                    event_type    TEXT NOT NULL,
                    slot          INTEGER NOT NULL,
                    signature     TEXT NOT NULL,
                    payload_b64   TEXT NOT NULL,
                    created_at    INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                    UNIQUE(signature, program, event_type)
                );
                CREATE TABLE cursor (
                    program       TEXT PRIMARY KEY,
                    last_slot     INTEGER NOT NULL,
                    updated_at    INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
                );
                INSERT INTO events(program, event_type, slot, signature, payload_b64)
                  VALUES ('aeqi_trust','TrustInitialized',100,'sigA','b64A'),
                         ('aeqi_factory','CompanySpawned',101,'sigA','b64B');
                "#,
            )
            .unwrap();
        }

        // Open via Sink — migration runs.
        let sink = Sink::open(&path).unwrap();
        assert_eq!(sink.event_count().unwrap(), 2);

        // Existing rows got log_index=0; same-type now requires a
        // distinct log_index.
        let dup =
            sink.record_event("aeqi_trust", "TrustInitialized", 100, "sigA", 0, "b64A").unwrap();
        assert!(!dup, "migrated row deduplicates on (..., log_index=0)");

        let new_log = sink
            .record_event("aeqi_trust", "TrustInitialized", 100, "sigA", 1, "b64Aprime")
            .unwrap();
        assert!(new_log, "new log_index for same type lands");
        assert_eq!(sink.event_count().unwrap(), 3);
    }

    #[test]
    fn typed_projection_lands_alongside_raw() {
        // End-to-end: insert a raw event, decode the matching typed
        // event, project it, verify the family table row appears with
        // structured columns set + a matching kind discriminator.
        use crate::events::{CapitalEvent, TreasuryDeposited, TypedEvent};

        let dir = tempfile::tempdir().unwrap();
        let sink = Sink::open(dir.path().join("typed.db")).unwrap();

        // Raw row first (mirrors the live tail order in main.rs).
        let raw_inserted = sink
            .record_event("aeqi_treasury", "TreasuryDeposited", 300, "sigTD", 0, "b64TD")
            .unwrap();
        assert!(raw_inserted);

        // Typed projection.
        let event = TypedEvent::Capital(CapitalEvent::Deposit(TreasuryDeposited {
            trust: [99u8; 32],
            depositor_ta: [88u8; 32],
            amount: 250_000,
        }));
        let typed_inserted = sink.record_typed(&event, 300, "sigTD", 0).unwrap();
        assert!(typed_inserted);

        // Counts: raw events = 1, capital_events = 1, others = 0.
        let counts = sink.typed_counts().unwrap();
        assert_eq!(counts.capital, 1);
        assert_eq!(counts.trust, 0);
        assert_eq!(counts.module, 0);
        assert_eq!(counts.acl, 0);
        assert_eq!(counts.governance, 0);
        assert_eq!(counts.feed, 0);
        assert_eq!(sink.event_count().unwrap(), 1);

        // Replay is idempotent on (signature, log_index).
        let replayed = sink.record_typed(&event, 300, "sigTD", 0).unwrap();
        assert!(!replayed);
        assert_eq!(sink.typed_counts().unwrap().capital, 1);
    }

    #[test]
    fn typed_projection_covers_all_six_families() {
        // Every family ships a row; the structured columns are
        // queryable by family-specific predicate. Mirrors "Graph-era
        // projection" coverage in the brief.
        use crate::events::{
            AclEvent, CapitalEvent, FeedEvent, GovernanceEvent, ModuleAclSet, ModuleEvent,
            ModuleRegistered, NavUpdated, ProposalCreated, TreasuryDeposited, TrustEvent,
            TrustInitialized, TypedEvent,
        };

        let dir = tempfile::tempdir().unwrap();
        let sink = Sink::open(dir.path().join("families.db")).unwrap();

        sink.record_typed(
            &TypedEvent::Trust(TrustEvent::Initialized(TrustInitialized {
                trust: [1; 32],
                trust_id: [2; 32],
                authority: [3; 32],
            })),
            10,
            "sigTrust",
            0,
        )
        .unwrap();
        sink.record_typed(
            &TypedEvent::Module(ModuleEvent::Registered(ModuleRegistered {
                trust: [1; 32],
                module_id: [4; 32],
                program_id: [5; 32],
                provider: [6; 32],
                implementation_version: 1,
                implementation_metadata_hash: [7; 32],
                trust_acl: 0xff,
            })),
            11,
            "sigMod",
            0,
        )
        .unwrap();
        sink.record_typed(
            &TypedEvent::Acl(AclEvent::Set(ModuleAclSet {
                trust: [1; 32],
                source_module_id: [4; 32],
                target_module_id: [8; 32],
                flags: 0b101,
            })),
            12,
            "sigAcl",
            0,
        )
        .unwrap();
        sink.record_typed(
            &TypedEvent::Governance(GovernanceEvent::ProposalCreated(ProposalCreated {
                trust: [1; 32],
                proposal_id: [9; 32],
                governance_config_id: [10; 32],
                proposer: [11; 32],
                vote_start: 1,
                vote_duration: 2,
            })),
            13,
            "sigGov",
            0,
        )
        .unwrap();
        sink.record_typed(
            &TypedEvent::Capital(CapitalEvent::Deposit(TreasuryDeposited {
                trust: [1; 32],
                depositor_ta: [12; 32],
                amount: 1_000,
            })),
            14,
            "sigCap",
            0,
        )
        .unwrap();
        sink.record_typed(
            &TypedEvent::Feed(FeedEvent::NavUpdated(NavUpdated {
                trust: [1; 32],
                fund_id: [13; 32],
                gross_nav: 500,
                high_water_mark: 600,
                accrued_carry: 7,
            })),
            15,
            "sigFeed",
            0,
        )
        .unwrap();

        let counts = sink.typed_counts().unwrap();
        assert_eq!(counts.trust, 1);
        assert_eq!(counts.module, 1);
        assert_eq!(counts.acl, 1);
        assert_eq!(counts.governance, 1);
        assert_eq!(counts.capital, 1);
        assert_eq!(counts.feed, 1);
    }

    #[test]
    fn typed_tables_appear_on_existing_v2_db() {
        // v2 → v3 is purely additive — opening a pre-existing v2 db
        // (already migrated past the v1 → v2 hop) must create the typed
        // family tables without disturbing the rows already in `events`.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("v2.db");

        // First open as v2 (which the current Sink::open is — v3 just
        // adds tables). Populate raw events.
        {
            let sink = Sink::open(&path).unwrap();
            sink.record_event("aeqi_trust", "TrustInitialized", 100, "sigA", 0, "b64A").unwrap();
            assert_eq!(sink.event_count().unwrap(), 1);
        }

        // Re-open — should still see the raw row AND have empty typed
        // family tables ready to write to.
        let sink2 = Sink::open(&path).unwrap();
        assert_eq!(sink2.event_count().unwrap(), 1);
        let counts = sink2.typed_counts().unwrap();
        assert_eq!(counts.trust, 0);
        assert_eq!(counts.module, 0);
    }

    #[test]
    fn cursor_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let sink = Sink::open(&path).unwrap();
        assert_eq!(sink.cursor("aeqi_trust").unwrap(), None);

        sink.bump_cursor("aeqi_trust", 100).unwrap();
        assert_eq!(sink.cursor("aeqi_trust").unwrap(), Some(100));

        // Cursor only moves forward
        sink.bump_cursor("aeqi_trust", 50).unwrap();
        assert_eq!(sink.cursor("aeqi_trust").unwrap(), Some(100));

        sink.bump_cursor("aeqi_trust", 200).unwrap();
        assert_eq!(sink.cursor("aeqi_trust").unwrap(), Some(200));
    }
}
