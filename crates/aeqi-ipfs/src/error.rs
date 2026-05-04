//! Error types for aeqi-ipfs.

use thiserror::Error;

/// Errors returned by [`crate::IpfsClient`] operations.
#[derive(Debug, Error)]
pub enum IpfsError {
    /// HTTP transport or timeout failure.
    #[error("IPFS HTTP error: {0}")]
    Http(#[from] reqwest::Error),

    /// The kubo response body could not be decoded as expected JSON.
    #[error("IPFS response decode error: {0}")]
    Decode(String),

    /// The `/api/v0/add` response did not contain a `Hash` field.
    #[error("IPFS add response missing CID")]
    MissingCid,

    /// The `/api/v0/version` health check returned a non-success status.
    #[error("IPFS daemon unhealthy: {0}")]
    Unhealthy(String),
}
