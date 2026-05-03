//! Chain interaction: alloy provider, block + log subscription, reorg tracking.
//!
//! Phase 1 deliverable. Connects to a JSON-RPC endpoint (HTTP for poll mode,
//! WS for subscribe mode) and streams events into the indexer store.

use anyhow::{Context, Result};
use rusqlite::{params, Connection};

/// Record a freshly committed block in `committed_blocks` and verify its
/// `parent_hash` matches the previously-committed block. Returns `Ok(true)`
/// if continuous, `Ok(false)` if a reorg is detected (caller should unwind).
pub fn commit_block(
    conn: &Connection,
    block_number: u64,
    block_hash: &str,
    parent_hash: &str,
) -> Result<bool> {
    let prev: Option<(i64, String)> = conn
        .query_row(
            "SELECT block_number, block_hash FROM committed_blocks
             ORDER BY block_number DESC LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();

    let continuous = match &prev {
        // No prior block → genesis-or-cold-start; always accept.
        None => true,
        // Prior block must be exactly one less + its hash must match parent_hash.
        Some((prev_num, prev_hash)) => {
            *prev_num as u64 + 1 == block_number && prev_hash == parent_hash
        }
    };

    conn.execute(
        "INSERT OR REPLACE INTO committed_blocks
            (block_number, block_hash, parent_hash, committed_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![
            block_number as i64,
            block_hash,
            parent_hash,
            chrono::Utc::now().timestamp()
        ],
    )?;

    Ok(continuous)
}

/// Unwind committed blocks above `safe_block` — invoked on reorg detection.
/// Currently this only deletes the committed_blocks rows; entity-row unwind
/// (deleting/reverting `trusts`, `accounts` etc.) is a Phase 2+ concern that
/// requires the full row_history table from the spec.
pub fn unwind_above(conn: &Connection, safe_block: u64) -> Result<usize> {
    let n = conn.execute(
        "DELETE FROM committed_blocks WHERE block_number > ?1",
        params![safe_block as i64],
    )?;
    if n > 0 {
        tracing::warn!(
            "reorg unwind: removed {} committed_blocks above {}",
            n,
            safe_block
        );
    }
    Ok(n)
}

/// Look up the highest committed block_number, used as the indexer's resume point.
pub fn highest_committed(conn: &Connection) -> Result<Option<u64>> {
    let n: Option<i64> = conn
        .query_row(
            "SELECT MAX(block_number) FROM committed_blocks",
            [],
            |r| r.get(0),
        )
        .unwrap_or(None);
    Ok(n.map(|x| x as u64))
}

/// Provider helpers — thin wrapper over alloy. Async because RPC calls are.
pub mod provider {
    use alloy::providers::{Provider, ProviderBuilder};
    use anyhow::{Context, Result};

    /// Build an HTTP provider for a given JSON-RPC URL. Use for polling-mode
    /// indexing (simpler than WS, fine for local Anvil and most testnets).
    pub fn http_provider(rpc_url: &str) -> Result<impl Provider> {
        let url = rpc_url.parse().context("parse rpc url")?;
        Ok(ProviderBuilder::new().connect_http(url))
    }

    /// Latest block number reachable from this provider — sanity check.
    pub async fn latest_block(p: &impl Provider) -> Result<u64> {
        Ok(p.get_block_number().await?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store;
    use tempfile::tempdir;

    fn fresh_db() -> (tempfile::TempDir, Connection) {
        let dir = tempdir().unwrap();
        let conn = store::open(dir.path().join("t.db")).expect("open");
        (dir, conn)
    }

    #[test]
    fn commit_continuous_blocks_reports_true() {
        let (_dir, conn) = fresh_db();

        // Block 1 (no prior) → continuous=true
        let ok1 = commit_block(&conn, 1, "0xhash1", "0xgenesis").unwrap();
        assert!(ok1);

        // Block 2 with parent=hash1 → continuous=true
        let ok2 = commit_block(&conn, 2, "0xhash2", "0xhash1").unwrap();
        assert!(ok2);
    }

    #[test]
    fn commit_with_wrong_parent_reports_false() {
        let (_dir, conn) = fresh_db();
        commit_block(&conn, 1, "0xhash1", "0xgenesis").unwrap();
        // Block 2 claims a different parent — reorg signal
        let ok = commit_block(&conn, 2, "0xhash2-fork", "0xWRONG").unwrap();
        assert!(!ok);
    }

    #[test]
    fn commit_with_skipped_block_reports_false() {
        let (_dir, conn) = fresh_db();
        commit_block(&conn, 1, "0xhash1", "0xgenesis").unwrap();
        // Skip block 2 → claim block 3 with valid hash → continuous=false
        let ok = commit_block(&conn, 3, "0xhash3", "0xhash1").unwrap();
        assert!(!ok);
    }

    #[test]
    fn unwind_clears_blocks_above_safe() {
        let (_dir, conn) = fresh_db();
        commit_block(&conn, 1, "0xhash1", "0xg").unwrap();
        commit_block(&conn, 2, "0xhash2", "0xhash1").unwrap();
        commit_block(&conn, 3, "0xhash3", "0xhash2").unwrap();

        let removed = unwind_above(&conn, 1).unwrap();
        assert_eq!(removed, 2);

        let highest = highest_committed(&conn).unwrap();
        assert_eq!(highest, Some(1));
    }

    #[test]
    fn highest_committed_works() {
        let (_dir, conn) = fresh_db();
        assert_eq!(highest_committed(&conn).unwrap(), None);
        commit_block(&conn, 5, "0xh5", "0xprev").unwrap();
        commit_block(&conn, 6, "0xh6", "0xh5").unwrap();
        assert_eq!(highest_committed(&conn).unwrap(), Some(6));
    }

    #[tokio::test]
    async fn provider_connects_to_anvil_if_running() {
        // Best-effort live check: only asserts when Anvil is actually up at 8545.
        // Skipped silently otherwise so CI doesn't depend on Anvil.
        let result = async {
            let p = provider::http_provider("http://127.0.0.1:8545")?;
            provider::latest_block(&p).await
        }
        .await;

        match result {
            Ok(n) => {
                tracing::info!("anvil latest block: {}", n);
                assert!(n >= 1, "expected anvil to have mined at least 1 block");
            }
            Err(_) => {
                eprintln!("anvil not reachable at :8545 — skipping live provider test");
            }
        }
    }
}
