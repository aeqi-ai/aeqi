//! aeqi-inference — OpenAI-compatible inference router with three billing lanes.
//!
//! ## Architecture
//!
//! ```text
//! caller
//!   │  Authorization: Bearer <JWT|api-key|eip3009-sig>
//!   │  X-Entity: <entity_id>          (subscription lane only)
//!   ▼
//! billing middleware (Tower layer, lane selected by auth header shape)
//!   ├── SubscriptionLayer  — JWT + dollar-balance debit
//!   ├── TreasuryLayer      — API-key + deposit-and-meter USDC (Phase 2)
//!   └── X402Layer          — EIP-3009 per-call USDC (Phase 2)
//!   ▼
//! axum router  (src/api.rs)
//!   ├── POST /v1/chat/completions
//!   ├── POST /v1/embeddings
//!   └── GET  /v1/models
//!   ▼
//! inference Router  (src/router.rs)
//!   │  dispatches by model prefix → UpstreamProvider
//!   ▼
//! upstream adapters  (src/upstream/)
//!   ├── DeepInfraProvider   (meta-llama/*, mistralai/*, Qwen/*, deepinfra/*) ← Phase 1 LIVE
//!   ├── OpenAiProvider      (gpt-*)      ← stub
//!   ├── AnthropicProvider   (claude-*)   ← stub
//!   └── DeepSeekProvider    (deepseek-*) ← stub
//! ```
//!
//! ## Phase status
//!
//! **Phase 1 (2026-05-05):** DeepInfra provider live with streaming + cost accounting.
//! Subscription lane gating by Bearer JWT + in-memory balance store.
//! aeqi-platform mounts `/v1/*` with subscription layer applied.
//!
//! **Phase 2:** Anthropic + OpenAI + DeepSeek adapters; SQLite balance debit;
//! x402 lane EIP-3009 settlement; treasury lane.
//!
//! ## Integration with aeqi-platform
//!
//! ```rust,ignore
//! use aeqi_inference::{AppState, DeepInfraProvider, InferenceRouter, create_router};
//! use aeqi_inference::billing::subscription::{BalanceStore, SubscriptionLayer};
//! use std::sync::Arc;
//!
//! let mut router = InferenceRouter::new();
//! router.register("deepinfra", Arc::new(DeepInfraProvider::from_env()));
//! let state = AppState::new(router, BalanceStore::new());
//! let inference_routes = create_router(state)
//!     .layer(SubscriptionLayer::new(BalanceStore::new()));
//! let app = axum_app.nest("/v1", inference_routes);
//! ```

pub mod api;
pub mod billing;
pub mod error;
pub mod router;
pub mod types;
pub mod upstream;

pub use api::{AppState, create_router};
pub use error::InferenceError;
pub use router::{Router as InferenceRouter, UpstreamProvider};
pub use types::{
    ChatCompletionChunk, ChatCompletionRequest, ChatCompletionResponse, ChatMessage,
    EmbeddingRequest, EmbeddingResponse, ModelInfo, ModelList,
};
pub use upstream::deepinfra::DeepInfraProvider;
