//! Crate-level error type for aeqi-inference.

use thiserror::Error;

/// All errors that can originate from the inference router.
#[derive(Debug, Error)]
pub enum InferenceError {
    /// Request lacks valid authentication credentials.
    #[error("authentication required")]
    Auth,

    /// Caller has insufficient balance to proceed.
    #[error("insufficient balance")]
    NoBalance,

    /// The upstream provider returned an error or is unreachable.
    #[error("upstream unavailable: {0}")]
    UpstreamUnavailable(String),

    /// Requested model or feature is not supported.
    #[error("unsupported: {0}")]
    Unsupported(String),

    /// Unexpected internal error.
    #[error("internal error: {0}")]
    Internal(String),
}

impl From<anyhow::Error> for InferenceError {
    fn from(e: anyhow::Error) -> Self {
        Self::Internal(e.to_string())
    }
}
