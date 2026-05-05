//! Upstream provider adapters.
//!
//! Each adapter implements [`crate::router::UpstreamProvider`].
//!
//! **Phase 1 (shipped 2026-05-05):**
//! - `deepinfra` — DeepInfra OpenAI-compatible endpoint, live with cost accounting.
//!
//! **Remaining stubs (Phase 2):**
//! - `anthropic` — Claude Sonnet 4.6 (primary agent model)
//! - `openai` — GPT-5 external-caller parity
//! - `deepseek` — DeepSeek V4 cheap open-weight

pub mod anthropic;
pub mod deepinfra;
pub mod deepseek;
pub mod openai;
