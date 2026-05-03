//! Indexer configuration. Loaded from env or config file.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexerConfig {
    pub rpc_url: String,
    pub chain_id: u64,
    pub factory_address: String,
    pub start_block: u64,
    pub confirmation_depth: u64,
    pub db_path: String,
    pub graphql_port: u16,
}

impl Default for IndexerConfig {
    fn default() -> Self {
        Self {
            rpc_url: "http://127.0.0.1:8545".to_string(),
            chain_id: 31337,
            factory_address: String::new(),
            start_block: 0,
            confirmation_depth: 12,
            db_path: "./aeqi-indexer.db".to_string(),
            graphql_port: 8500,
        }
    }
}
