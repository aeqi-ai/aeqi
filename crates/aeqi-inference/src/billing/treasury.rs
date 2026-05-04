//! Treasury billing lane — API-key auth + deposit-and-meter USDC.
//!
//! **Status: stub — returns 503 Service Unavailable for all requests.**
//!
//! This lane becomes live in Phase 2 after the WS-4 wallet build ships the
//! Entity smart contract with IAccount + session keys.
//!
//! **Phase 2 TODO:**
//! - Decode API key from `Authorization: Bearer <api-key>`.
//! - Recover signer via ECDSA from the key; verify against Entity's on-chain ACL.
//! - Read deposit balance from alloy provider call (10-sec TTL cache).
//! - Insert debit row into `treasury_inference_ledger` post-response.
//! - Hourly cron: batch settled rows → emit `InferenceCharge` event → bundler.

use std::task::{Context, Poll};

use axum::http::{Request, Response, StatusCode};
use futures::future::BoxFuture;
use tower::{Layer, Service};

/// Tower layer for the treasury billing lane.
#[derive(Clone, Default)]
pub struct TreasuryLayer;

impl TreasuryLayer {
    pub fn new() -> Self {
        Self
    }
}

impl<S> Layer<S> for TreasuryLayer {
    type Service = TreasuryMiddleware<S>;

    fn layer(&self, inner: S) -> Self::Service {
        TreasuryMiddleware { inner }
    }
}

/// Tower service — stub that always returns 503.
#[derive(Clone)]
pub struct TreasuryMiddleware<S> {
    inner: S,
}

impl<S, ReqBody, ResBody> Service<Request<ReqBody>> for TreasuryMiddleware<S>
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
        // Phase 2: implement treasury lane. Until then, reject all calls
        // so callers know this lane is not yet available.
        tracing::warn!("treasury lane is not yet implemented — returning 503");
        Box::pin(async move {
            let mut res = Response::new(ResBody::default());
            *res.status_mut() = StatusCode::SERVICE_UNAVAILABLE;
            Ok(res)
        })
    }
}
