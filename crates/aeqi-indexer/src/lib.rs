//! aeqi-indexer — native Rust EVM event indexer for AEQI TRUST contracts.
//!
//! Replaces the TheGraph subgraph at `~/projects/aeqi-graph`. SQLite-backed,
//! async-graphql API, runs alongside the aeqi runtime.
//!
//! See `docs/aeqi-indexer-spec.md` for the canonical architecture.

pub mod api;
pub mod chain;
pub mod config;
pub mod decode;
pub mod store;

/// Crate version for diagnostics.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
