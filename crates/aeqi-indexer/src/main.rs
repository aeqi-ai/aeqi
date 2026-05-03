//! aeqi-indexer binary entry point.
//!
//! Phase 0 hello-world: connect to RPC, log latest block, exit.

use anyhow::Result;
use tracing::{info, Level};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt().with_max_level(Level::INFO).init();
    info!("aeqi-indexer v{} starting (Phase 0 scaffold)", aeqi_indexer::VERSION);
    info!("Spec: docs/aeqi-indexer-spec.md");
    info!("Build log: docs/indexer-build-log.md");
    Ok(())
}
