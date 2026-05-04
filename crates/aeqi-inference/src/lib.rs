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
//!   └── X402Layer          — EIP-3009 per-call USDC (Phase 1)
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
//!   ├── OpenAiProvider      (gpt-*)
//!   ├── AnthropicProvider   (claude-*)
//!   └── DeepSeekProvider    (deepseek-*)
//! ```
//!
//! ## Phase status
//!
//! **Skeleton (current):** all upstream adapters are `unimplemented!()` stubs.
//! Billing middleware checks auth header presence and stub balance, but does not
//! call any real provider or charge any real money.
//!
//! **Phase 1 (~3-4 weeks):** wire Anthropic → OpenAI → DeepSeek adapters;
//! implement subscription lane JWT validation + SQLite balance debit; implement
//! x402 lane EIP-3009 settlement via Coinbase Facilitator.
//!
//! **Phase 2 (~2 weeks after WS-4 wallet build):** treasury lane live.
//!
//! ## Integration with aeqi-platform (Wave 4)
//!
//! ```rust,ignore
//! use aeqi_inference::{api::{AppState, create_router}, router::Router as InferenceRouter};
//!
//! let inference_state = AppState::new(InferenceRouter::new(), Default::default());
//! let app = axum_app
//!     .nest("/v1", create_router(inference_state.clone()))
//!     .nest("/api/v1", create_router(inference_state));
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
