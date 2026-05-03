//! aeqi-indexer binary entry point.
//!
//! Phase 0 hello-world:
//!   - opens SQLite at AEQI_INDEXER_DB (default ./aeqi-indexer.db)
//!   - applies migrations
//!   - starts GraphQL server on AEQI_INDEXER_PORT (default 8500)
//!   - logs URLs

use aeqi_indexer::{api, store};
use anyhow::Result;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{info, Level};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_max_level(Level::INFO)
        .with_target(false)
        .init();

    let db_path = std::env::var("AEQI_INDEXER_DB").unwrap_or_else(|_| "./aeqi-indexer.db".to_string());
    let port: u16 = std::env::var("AEQI_INDEXER_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(8500);

    info!("aeqi-indexer v{} starting", aeqi_indexer::VERSION);
    info!("db: {}", db_path);

    let conn = store::open(&db_path)?;
    let db = Arc::new(Mutex::new(conn));

    api::serve(port, db).await?;
    Ok(())
}
