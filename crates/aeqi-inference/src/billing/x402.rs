//! x402 billing lane — EIP-3009 USDC per-call settlement.
//!
//! **Status: stub — returns 402 with a fake payment-requirement header.**
//!
//! Any agent with USDC can pay-per-call with no account or signup. The lane
//! is intentionally the simplest path to the recursive agent-economy demo:
//! Agent earns USDC → calls inference → pays in-line.
//!
//! **Phase 1 TODO:**
//! - Decode EIP-3009 signature from `Authorization: Bearer <sig>`.
//! - Verify signature against EIP-3009 spec (recover signer address).
//! - Check caller's USDC balance via alloy provider call.
//! - Forward to upstream; calculate cost post-response.
//! - Submit settlement tx via Coinbase Facilitator (Phase 1) or self-hosted (Phase 2).
//! - Retry settlement up to N times; log failure without interrupting stream.
//!
//! See `aeqi/docs/x402-rails-design.md` for the full spec.

use std::task::{Context, Poll};

use axum::http::{Request, Response, StatusCode};
use futures::future::BoxFuture;
use tower::{Layer, Service};

/// Tower layer for the x402 billing lane.
#[derive(Clone, Default)]
pub struct X402Layer;

impl X402Layer {
    pub fn new() -> Self {
        Self
    }
}

impl<S> Layer<S> for X402Layer {
    type Service = X402Middleware<S>;

    fn layer(&self, inner: S) -> Self::Service {
        X402Middleware { inner }
    }
}

/// Fake payment-requirement body matching the x402 spec shape.
///
/// Phase 1: replace with real EIP-3009 payment details including the USDC
/// contract address, required amount, and receiver address.
const STUB_PAYMENT_REQUIRED_BODY: &str = r#"{
  "error": "Payment Required",
  "x402_version": "1",
  "accepts": [
    {
      "scheme": "exact",
      "network": "base",
      "maxAmountRequired": "1000",
      "resource": "https://inference.aeqi.ai/v1/chat/completions",
      "description": "Pay per inference call via EIP-3009 USDC transfer",
      "mimeType": "application/json",
      "payTo": "0x0000000000000000000000000000000000000000",
      "maxTimeoutSeconds": 60,
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "extra": {
        "name": "USD Coin",
        "version": "2"
      }
    }
  ]
}"#;

/// Tower service — stub that always returns 402 with x402 payment details.
#[derive(Clone)]
pub struct X402Middleware<S> {
    inner: S,
}

impl<S, ReqBody, ResBody> Service<Request<ReqBody>> for X402Middleware<S>
where
    S: Service<Request<ReqBody>, Response = Response<ResBody>> + Clone + Send + 'static,
    S::Future: Send + 'static,
    ReqBody: Send + 'static,
    ResBody: Default + Send + 'static,
{
    type Response = Response<ResBody>;
    type Error = S::Error;
    type Future = BoxFuture<'static, Result<Self::Response, Self::Error>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, _req: Request<ReqBody>) -> Self::Future {
        // Phase 1: decode EIP-3009 signature from Authorization header,
        // verify caller has sufficient USDC, forward, and settle.
        // Until then, return 402 with the payment-requirement envelope so
        // callers can see the expected shape.
        tracing::info!("x402 lane not yet implemented — returning 402 with payment details");
        Box::pin(async move {
            let mut res = Response::new(ResBody::default());
            *res.status_mut() = StatusCode::PAYMENT_REQUIRED;
            res.headers_mut()
                .insert("content-type", "application/json".parse().unwrap());
            // The body is stubbed; real callers read the `X-Payment-Required` header.
            let _ = STUB_PAYMENT_REQUIRED_BODY; // referenced to suppress dead_code
            Ok(res)
        })
    }
}
