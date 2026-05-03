//! Chain interaction: RPC client, block fetcher, log subscription, reorg handling.
//!
//! Phase 1 territory. Currently scaffold-only.

pub mod block_fetcher {
    //! Block + log fetching from EVM RPC.
}

pub mod reorg {
    //! Reorg detection + rollback. See spec § Reorg handling.
}
