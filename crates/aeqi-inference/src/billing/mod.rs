//! Billing lanes for aeqi-inference.
//!
//! Three lanes gate every inference request before it reaches the upstream:
//!
//! 1. **Subscription** — JWT auth, dollar-denominated balance per Company.
//! 2. **Treasury** — API-key auth (Entity signer), deposit-and-meter USDC.
//! 3. **x402** — EIP-3009 USDC signature, per-call settlement. Any agent, no signup.
//!
//! Each lane is a Tower [`Layer`] + [`Service`] pair. The middleware stack in
//! `src/api.rs` selects a lane based on the `Authorization` header shape.
//!
//! Phase 1 implements Subscription and x402 stubs; Treasury becomes live in
//! Phase 2 after the WS-4 wallet build is complete.

pub mod subscription;
pub mod treasury;
pub mod x402;

use crate::error::InferenceError;

/// Result of a billing pre-check.
#[derive(Debug)]
pub enum BillingOutcome {
    /// Request is cleared to proceed; attach the billing context to the request
    /// so the post-response handler can debit the actual cost.
    Approved {
        /// Unique identifier for the billing subject (entity_id for sub/treasury,
        /// payer address for x402).
        subject: String,
        /// Lane that approved the request.
        lane: BillingLane,
    },
    /// Caller is not authorised (missing / invalid credentials).
    Unauthorized,
    /// Caller's balance is zero and no credit is available.
    InsufficientFunds,
}

/// Which billing lane handled the request.
#[derive(Debug, Clone, Copy)]
pub enum BillingLane {
    Subscription,
    Treasury,
    X402,
}

/// Shared trait for billing lane pre-checks.
///
/// Phase 1: `check` is a stub — real implementations come in the billing
/// middleware services in each lane submodule.
pub trait BillingCheck: Send + Sync {
    fn check(&self, auth_header: Option<&str>, entity_header: Option<&str>) -> BillingOutcome;
}

/// Estimate a cost in cents for a chat completion request.
///
/// Uses worst-case pre-call estimation: token count approximated as
/// `total_input_chars / 4` (Claude's ~4 chars/token rule). Actual debit
/// happens post-response using the provider's reported token count.
///
/// Phase 1: returns a fixed stub of `1` cent so the balance check can fire.
pub fn estimate_cost_cents(_prompt_chars: usize) -> u32 {
    // Phase 1 stub — real formula: (prompt_chars / 4) * rate_per_token
    1
}

/// Convert a provider's reported token count to cents.
///
/// Phase 1 stub — wired in post-response handler once providers return usage.
pub fn tokens_to_cents(_tokens: u32, _model: &str) -> u32 {
    // Phase 1 stub — rate table populated in Phase 1 implementation
    1
}

/// Map an `InferenceError` billing variant to an HTTP status code.
pub fn billing_status(err: &InferenceError) -> u16 {
    match err {
        InferenceError::Auth => 401,
        InferenceError::NoBalance => 402,
        _ => 500,
    }
}
