//! Crate-level error type for aeqi-inference.
//!
//! The variant set is a typed failover taxonomy: callers (orchestrator
//! retry loop, billing layer, compactor) consult `retryable()` /
//! `should_compress()` / `should_rotate_credential()` / `should_failover()`
//! instead of string-matching on `UpstreamUnavailable` messages. Quest
//! 67-184 (hermes-comparison) expanded this from a 5-variant placeholder.
//!
//! Provider adapters convert HTTP status codes to typed variants where the
//! mapping is obvious (429 → `RateLimit`, 503 → `Overloaded`, 401/403 →
//! `Auth`); ambiguous failures stay on `UpstreamUnavailable(String)` and
//! migrate to typed variants as provider-specific parsing lands.

use thiserror::Error;

/// All errors that can originate from the inference router.
#[derive(Debug, Error)]
pub enum InferenceError {
    /// Request lacks valid authentication credentials. Refresh / re-issue.
    #[error("authentication required")]
    Auth,

    /// Authentication permanently invalid (e.g. revoked key). Don't retry;
    /// rotate the credential.
    #[error("authentication permanently invalid")]
    AuthPermanent,

    /// Caller has insufficient balance to proceed.
    #[error("insufficient balance")]
    NoBalance,

    /// Provider billing surface rejected the call (overdue invoice, hard
    /// spend cap reached). Rotate the credential rather than retry.
    #[error("billing rejected")]
    Billing,

    /// Provider returned 429 / equivalent. Back off and retry; honour
    /// `retry_after_secs` when supplied.
    #[error("rate limited{}", retry_after_secs.map(|s| format!(" (retry after {s}s)")).unwrap_or_default())]
    RateLimit { retry_after_secs: Option<u32> },

    /// Provider is overloaded (503 or equivalent). Back off and retry; if
    /// failover is configured, prefer it.
    #[error("provider overloaded")]
    Overloaded,

    /// Provider returned 5xx unrelated to overload. Retry with backoff.
    #[error("upstream server error: {0}")]
    ServerError(String),

    /// Network / read timeout on the upstream call. Retry with backoff.
    #[error("upstream timeout")]
    Timeout,

    /// Request context exceeded the provider's window. Compact + retry.
    #[error("context window overflow")]
    ContextOverflow,

    /// Requested model isn't recognised by the upstream. Don't retry.
    #[error("model not found: {0}")]
    ModelNotFound(String),

    /// The upstream provider returned an error or is unreachable, and we
    /// haven't classified it into a typed variant yet. Conservative
    /// fallback — callers should treat as retryable but unspecific.
    #[error("upstream unavailable: {0}")]
    UpstreamUnavailable(String),

    /// Requested model or feature is not supported by aeqi or by the
    /// configured providers. Don't retry.
    #[error("unsupported: {0}")]
    Unsupported(String),

    /// Unexpected internal error.
    #[error("internal error: {0}")]
    Internal(String),
}

impl InferenceError {
    /// True if a retry of the same call (possibly after a delay) may succeed.
    /// Caller should also consult `should_compress` and `should_failover`
    /// to decide retry shape.
    pub fn retryable(&self) -> bool {
        matches!(
            self,
            Self::RateLimit { .. }
                | Self::Overloaded
                | Self::ServerError(_)
                | Self::Timeout
                | Self::ContextOverflow
                | Self::UpstreamUnavailable(_)
        )
    }

    /// True if the failure stems from a context-window overflow; the
    /// caller should compact + retry (the same provider will accept the
    /// retry if the context fits).
    pub fn should_compress(&self) -> bool {
        matches!(self, Self::ContextOverflow)
    }

    /// True if the failure is credential-shaped and the caller should
    /// rotate to a fresh credential before retrying (rather than burn
    /// the next attempt on the same revoked / over-budget key).
    pub fn should_rotate_credential(&self) -> bool {
        matches!(self, Self::AuthPermanent | Self::Billing | Self::NoBalance)
    }

    /// True if the failure indicates the provider is degraded, and the
    /// retry should go to a different provider (when failover is wired)
    /// rather than the same one.
    pub fn should_failover(&self) -> bool {
        matches!(
            self,
            Self::Overloaded | Self::ServerError(_) | Self::Timeout
        )
    }
}

impl From<anyhow::Error> for InferenceError {
    fn from(e: anyhow::Error) -> Self {
        Self::Internal(e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rate_limit_is_retryable_and_neither_compress_nor_rotate_nor_failover() {
        let e = InferenceError::RateLimit {
            retry_after_secs: Some(30),
        };
        assert!(e.retryable());
        assert!(!e.should_compress());
        assert!(!e.should_rotate_credential());
        assert!(!e.should_failover());
        // Display carries the retry-after hint.
        assert_eq!(e.to_string(), "rate limited (retry after 30s)");
    }

    #[test]
    fn context_overflow_triggers_compress_only() {
        let e = InferenceError::ContextOverflow;
        assert!(e.retryable());
        assert!(e.should_compress());
        assert!(!e.should_rotate_credential());
        assert!(!e.should_failover());
    }

    #[test]
    fn auth_permanent_and_billing_rotate_but_dont_retry() {
        for e in [InferenceError::AuthPermanent, InferenceError::Billing] {
            assert!(!e.retryable(), "{e:?} must not be retryable");
            assert!(e.should_rotate_credential(), "{e:?} must rotate");
            assert!(!e.should_compress());
            assert!(!e.should_failover());
        }
    }

    #[test]
    fn overloaded_and_server_error_failover() {
        let cases = [
            InferenceError::Overloaded,
            InferenceError::ServerError("oom".into()),
            InferenceError::Timeout,
        ];
        for e in cases {
            assert!(e.retryable());
            assert!(e.should_failover());
            assert!(!e.should_compress());
            assert!(!e.should_rotate_credential());
        }
    }

    #[test]
    fn unsupported_and_model_not_found_are_terminal() {
        for e in [
            InferenceError::Unsupported("model-x".into()),
            InferenceError::ModelNotFound("model-y".into()),
        ] {
            assert!(!e.retryable(), "{e:?} must not be retryable");
            assert!(!e.should_compress());
            assert!(!e.should_rotate_credential());
            assert!(!e.should_failover());
        }
    }

    #[test]
    fn unspecific_upstream_unavailable_is_retryable_but_unclassified() {
        let e = InferenceError::UpstreamUnavailable("connection reset".into());
        assert!(e.retryable());
        assert!(!e.should_compress());
        assert!(!e.should_rotate_credential());
        assert!(!e.should_failover());
    }
}
