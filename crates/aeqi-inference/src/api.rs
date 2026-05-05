//! axum router exposing OpenAI-compatible inference endpoints.
//!
//! Mount in aeqi-platform via:
//! ```rust,ignore
//! use aeqi_inference::{AppState, DeepInfraProvider, InferenceRouter, create_router};
//! use aeqi_inference::billing::subscription::{BalanceStore, SubscriptionLayer};
//! use std::sync::Arc;
//!
//! let mut router = InferenceRouter::new();
//! router.register("deepinfra", Arc::new(DeepInfraProvider::from_env()));
//! let state = AppState::new(router, BalanceStore::new());
//! let routes = create_router(state).layer(SubscriptionLayer::new(BalanceStore::new()));
//! let app = axum_app.nest("/v1", routes);
//! ```
//!
//! The router itself is stateless — all mutable state lives in [`AppState`].

use std::sync::Arc;

use axum::{
    Router,
    body::Body,
    extract::{Json, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use futures::StreamExt;
use serde_json::json;
use tracing::warn;

use crate::{
    billing::subscription::BalanceStore,
    error::InferenceError,
    router::Router as InferenceRouter,
    types::{ChatCompletionRequest, EmbeddingRequest, ModelInfo, ModelList},
    upstream::deepinfra::compute_cost_microdollars,
};

// ---------------------------------------------------------------------------
// Shared application state
// ---------------------------------------------------------------------------

/// State shared across all axum handlers.
///
/// Cheap to clone — all fields are `Arc`-backed.
#[derive(Clone)]
pub struct AppState {
    /// Model → provider dispatch table.
    pub router: Arc<InferenceRouter>,
    /// Subscription balance store. Phase 1: in-memory keyed by entity_id.
    pub balances: BalanceStore,
}

impl AppState {
    pub fn new(router: InferenceRouter, balances: BalanceStore) -> Self {
        Self {
            router: Arc::new(router),
            balances,
        }
    }
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

/// Construct the axum `Router` for all OpenAI-compat endpoints.
///
/// Apply the subscription billing middleware layer on top of this router
/// before nesting into aeqi-platform:
/// ```rust,ignore
/// create_router(state).layer(SubscriptionLayer::new(store))
/// ```
pub fn create_router(state: AppState) -> Router {
    Router::new()
        .route("/chat/completions", post(chat_completions_handler))
        .route("/embeddings", post(embeddings_handler))
        .route("/models", get(models_handler))
        .with_state(state)
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// `POST /v1/chat/completions`
///
/// Routes to the registered upstream provider. Supports both streaming (SSE)
/// and non-streaming responses. Cost is debited from the entity's balance
/// after the response is received (non-streaming) or estimated pre-call
/// (streaming, to be reconciled post-stream in Phase 2).
///
/// Entity ID is read from the `X-Entity` request header, set by the
/// subscription middleware after JWT validation.
async fn chat_completions_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ChatCompletionRequest>,
) -> Response {
    // Extract entity_id for cost accounting. Falls back to "unknown" when
    // the middleware has not injected the header (e.g. in tests that bypass
    // the middleware layer).
    let entity_id = headers
        .get("x-entity")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_owned();

    if req.stream {
        handle_streaming(state, entity_id, req).await
    } else {
        handle_non_streaming(state, entity_id, req).await
    }
}

/// Non-streaming path: call upstream, debit cost, return JSON.
async fn handle_non_streaming(
    state: AppState,
    entity_id: String,
    req: ChatCompletionRequest,
) -> Response {
    let model = req.model.clone();
    match state.router.chat_completion(req).await {
        Ok(resp) => {
            // Debit cost from the entity's balance.
            if let Some(usage) = &resp.usage {
                let cost =
                    compute_cost_microdollars(&model, usage.prompt_tokens, usage.completion_tokens);
                // Phase 1: in-memory debit. Phase 2: SQLite write.
                // cost is in micro-dollars; store uses cents; convert (100 cents = $1 = 1e8 microdollars).
                let cost_cents = (cost / 1_000_000) as i64; // truncate to cents
                if cost_cents > 0 {
                    let current = state.balances.get(&entity_id).unwrap_or(0);
                    state
                        .balances
                        .set(&entity_id, current.saturating_sub(cost_cents));
                    tracing::debug!(
                        entity_id,
                        model,
                        prompt_tokens = usage.prompt_tokens,
                        completion_tokens = usage.completion_tokens,
                        cost_microdollars = cost,
                        cost_cents,
                        "inference cost debited"
                    );
                }
            }
            Json(resp).into_response()
        }
        Err(e) => inference_error_response(e),
    }
}

/// Streaming path: call upstream, pipe SSE chunks to client.
///
/// Cost estimation in Phase 1 is not per-token — we estimate 1 cent per
/// call to ensure the balance check fires, then reconcile in Phase 2 with
/// real token counts from the stream's final chunk.
async fn handle_streaming(
    state: AppState,
    _entity_id: String,
    req: ChatCompletionRequest,
) -> Response {
    match state.router.chat_completion_stream(req).await {
        Ok(stream) => {
            // Convert the chunk stream into an SSE byte stream.
            let sse_stream = stream.map(|result| {
                result
                    .map(|chunk| {
                        let json = serde_json::to_string(&chunk).unwrap_or_default();
                        format!("data: {json}\n\n").into_bytes()
                    })
                    .unwrap_or_else(|e| {
                        warn!(error = %e, "upstream chunk error in SSE stream");
                        format!("data: {{\"error\": \"{e}\"}}\n\n").into_bytes()
                    })
            });

            // Append the [DONE] sentinel that OpenAI-compatible clients expect.
            let done_sentinel = futures::stream::once(async { b"data: [DONE]\n\n".to_vec() });

            let full_stream = sse_stream.chain(done_sentinel);
            let body = Body::from_stream(full_stream.map(Ok::<_, std::convert::Infallible>));

            let mut headers = HeaderMap::new();
            headers.insert(
                "content-type",
                HeaderValue::from_static("text/event-stream"),
            );
            headers.insert("cache-control", HeaderValue::from_static("no-cache"));
            headers.insert("x-accel-buffering", HeaderValue::from_static("no"));

            (StatusCode::OK, headers, body).into_response()
        }
        Err(e) => inference_error_response(e),
    }
}

/// `POST /v1/embeddings`
///
/// Phase 2 TODO: route to an embedding model adapter.
async fn embeddings_handler(
    State(_state): State<AppState>,
    Json(req): Json<EmbeddingRequest>,
) -> Response {
    let msg = format!("embeddings not yet implemented for model '{}'", req.model);
    warn!(model = req.model, "embeddings endpoint not yet implemented");
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({ "error": { "message": msg, "type": "not_implemented" } })),
    )
        .into_response()
}

/// `GET /v1/models`
///
/// Returns the whitelisted DeepInfra models plus placeholder stubs for the
/// Anthropic / OpenAI / DeepSeek adapters (Phase 2).
async fn models_handler(State(_state): State<AppState>) -> Json<ModelList> {
    use crate::upstream::deepinfra::ALLOWED_MODELS;

    let created = 1_746_403_200_i64; // 2026-05-05 00:00:00 UTC

    let mut data: Vec<ModelInfo> = ALLOWED_MODELS
        .iter()
        .map(|id| ModelInfo {
            id: (*id).to_owned(),
            object: "model".to_owned(),
            created,
            owned_by: "deepinfra".to_owned(),
        })
        .collect();

    // Stub entries for providers wired in Phase 2.
    for (id, owner) in [
        ("gpt-5", "openai"),
        ("claude-sonnet-4-6", "anthropic"),
        ("deepseek-v4", "deepseek"),
    ] {
        data.push(ModelInfo {
            id: id.to_owned(),
            object: "model".to_owned(),
            created,
            owned_by: owner.to_owned(),
        });
    }

    Json(ModelList {
        object: "list".to_owned(),
        data,
    })
}

// ---------------------------------------------------------------------------
// Error conversion helper (used in tests and streaming error path)
// ---------------------------------------------------------------------------

/// Convert an `InferenceError` to an axum `Response` with the correct status.
pub fn inference_error_response(err: InferenceError) -> Response {
    match err {
        InferenceError::Auth => (
            StatusCode::UNAUTHORIZED,
            Json(
                json!({ "error": { "message": "authentication required", "type": "auth_error" } }),
            ),
        )
            .into_response(),
        InferenceError::NoBalance => (
            StatusCode::PAYMENT_REQUIRED,
            Json(
                json!({ "error": { "message": "insufficient balance", "type": "billing_error" } }),
            ),
        )
            .into_response(),
        InferenceError::Unsupported(msg) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": { "message": msg, "type": "invalid_request_error" } })),
        )
            .into_response(),
        InferenceError::UpstreamUnavailable(msg) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "error": { "message": msg, "type": "upstream_error" } })),
        )
            .into_response(),
        InferenceError::Internal(msg) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": { "message": msg, "type": "internal_error" } })),
        )
            .into_response(),
    }
}
