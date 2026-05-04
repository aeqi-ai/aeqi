//! Upstream provider adapter stubs.
//!
//! Each adapter implements [`crate::router::UpstreamProvider`]. The bodies
//! are `unimplemented!()` placeholders — real HTTP calls come in Phase 1.
//!
//! **Phase 1 implementation order (recommended):**
//! 1. `anthropic` — Claude Sonnet 4.6 is the primary agent model; wire it first.
//! 2. `openai` — GPT-5 for external-caller parity (most clients test against OpenAI).
//! 3. `deepseek` — DeepSeek V4 is the cheapest open-weight; unlocks the
//!    90M-tokens-per-$25 subscription value prop.
//!
//! Each adapter will need:
//! - An API key injected via constructor (read from env at startup in aeqi-platform).
//! - A `reqwest::Client` (cheap to clone; share one per adapter instance).
//! - Request transformation: our `ChatCompletionRequest` → provider's native shape.
//! - SSE response parsing into `ChatCompletionChunk` stream.

pub mod anthropic;
pub mod deepseek;
pub mod openai;
