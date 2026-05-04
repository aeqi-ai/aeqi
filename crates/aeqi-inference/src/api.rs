//! axum router exposing OpenAI-compatible inference endpoints.
//!
//! Mount in aeqi-platform (Wave 4 task) via:
//! ```ignore
//! app.nest("/v1",   aeqi_inference::api::create_router(state.clone()))
//!    .nest("/api/v1", aeqi_inference::api::create_router(state))
//! ```
//!
//! The router itself is stateless — all mutable state lives in [`AppState`].

use std::sync::Arc;

use axum::{
    Router,
    extract::{Json, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde_json::json;

use crate::{
    billing::subscription::BalanceStore,
    error::InferenceError,
    router::Router as InferenceRouter,
    types::{ChatCompletionRequest, EmbeddingRequest, ModelInfo, ModelList},
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
    /// Subscription balance store (stub in-memory for skeleton; SQLite in Phase 1).
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
/// The caller is responsible for adding billing middleware layers on top
/// (subscription / treasury / x402) before nesting into aeqi-platform.
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
/// Accepts an OpenAI-compatible [`ChatCompletionRequest`]. Routes to the
/// registered upstream provider for the requested model.
///
/// Current stub behaviour:
/// - If `model` is not in the routing table → 400 Bad Request.
/// - Non-streaming response only (streaming wire-up is Phase 1).
///
/// Phase 1: add SSE response path when `req.stream == true`.
async fn chat_completions_handler(
    State(state): State<AppState>,
    Json(req): Json<ChatCompletionRequest>,
) -> Response {
    match state.router.chat_completion(req).await {
        Ok(resp) => Json(resp).into_response(),
        Err(InferenceError::Unsupported(msg)) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": { "message": msg, "type": "invalid_request_error" } })),
        )
            .into_response(),
        Err(InferenceError::Auth) => (
            StatusCode::UNAUTHORIZED,
            Json(
                json!({ "error": { "message": "authentication required", "type": "auth_error" } }),
            ),
        )
            .into_response(),
        Err(InferenceError::NoBalance) => (
            StatusCode::PAYMENT_REQUIRED,
            Json(
                json!({ "error": { "message": "insufficient balance", "type": "billing_error" } }),
            ),
        )
            .into_response(),
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "error": { "message": e.to_string(), "type": "upstream_error" } })),
        )
            .into_response(),
    }
}

/// `POST /v1/embeddings`
///
/// Accepts an [`EmbeddingRequest`], returns an [`EmbeddingResponse`].
///
/// Phase 1 TODO: route to the appropriate embedding model adapter (OpenAI
/// `text-embedding-3`, or an open-source alternative via DeepInfra).
async fn embeddings_handler(
    State(_state): State<AppState>,
    Json(req): Json<EmbeddingRequest>,
) -> Response {
    // Phase 1: implement real embedding call.
    // For now, reject so callers know this endpoint exists but is not yet live.
    let msg = format!(
        "embeddings not yet implemented for model '{}' — Phase 1 build follow-up",
        req.model
    );
    tracing::warn!(model = req.model, "embeddings endpoint not yet implemented");
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({ "error": { "message": msg, "type": "not_implemented" } })),
    )
        .into_response()
}

/// `GET /v1/models`
///
/// Returns a static list of supported model IDs. Phase 1: keep this static
/// and driven by the routing table; update when providers are wired.
async fn models_handler(State(_state): State<AppState>) -> Json<ModelList> {
    // Static model list. Phase 1: derive from the registered provider table.
    let created = 1_746_316_800_i64; // 2026-05-04 00:00:00 UTC

    Json(ModelList {
        object: "list".to_owned(),
        data: vec![
            ModelInfo {
                id: "gpt-5".to_owned(),
                object: "model".to_owned(),
                created,
                owned_by: "openai".to_owned(),
            },
            ModelInfo {
                id: "claude-sonnet-4-6".to_owned(),
                object: "model".to_owned(),
                created,
                owned_by: "anthropic".to_owned(),
            },
            ModelInfo {
                id: "deepseek-v4".to_owned(),
                object: "model".to_owned(),
                created,
                owned_by: "deepseek".to_owned(),
            },
            ModelInfo {
                id: "llama-4-large".to_owned(),
                object: "model".to_owned(),
                created,
                owned_by: "meta".to_owned(),
            },
        ],
    })
}

// ---------------------------------------------------------------------------
// Error conversion helper (used in tests)
// ---------------------------------------------------------------------------

/// Convert an `InferenceError` to an axum `Response` with the correct status.
pub fn inference_error_response(err: InferenceError) -> Response {
    match err {
        InferenceError::Auth => (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": { "message": "authentication required" } })),
        )
            .into_response(),
        InferenceError::NoBalance => (
            StatusCode::PAYMENT_REQUIRED,
            Json(json!({ "error": { "message": "insufficient balance" } })),
        )
            .into_response(),
        InferenceError::Unsupported(msg) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": { "message": msg } })),
        )
            .into_response(),
        InferenceError::UpstreamUnavailable(msg) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "error": { "message": msg } })),
        )
            .into_response(),
        InferenceError::Internal(msg) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": { "message": msg } })),
        )
            .into_response(),
    }
}
