//! DeepSeek upstream adapter stub.
//!
//! Handles models whose prefix resolves to `"deepseek"` — e.g. `deepseek-v4`.
//!
//! DeepSeek's API is OpenAI-compatible (same `/v1/chat/completions` endpoint),
//! so the implementation is nearly identical to `OpenAiProvider` with a
//! different base URL and key.
//!
//! **Phase 1 TODO:**
//! - POST `https://api.deepseek.com/v1/chat/completions` with
//!   `Authorization: Bearer <key>`.
//! - Because the shape is OpenAI-identical, the implementation can delegate
//!   to a shared `openai_compat_call(base_url, api_key, req)` helper.
//! - Read key from env `DEEPSEEK_API_KEY`.
//! - DeepSeek is the cheapest open-weight; unlocks the 90M-tokens/$25 value prop.
//!   Wire it right after Anthropic.

use async_trait::async_trait;
use futures::stream::BoxStream;

use crate::{
    error::InferenceError,
    router::UpstreamProvider,
    types::{ChatCompletionChunk, ChatCompletionRequest, ChatCompletionResponse},
};

/// DeepSeek API adapter.
///
/// Phase 1: add `api_key: String` field; read from env `DEEPSEEK_API_KEY`.
#[derive(Clone, Debug, Default)]
pub struct DeepSeekProvider;

impl DeepSeekProvider {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl UpstreamProvider for DeepSeekProvider {
    async fn chat_completion(
        &self,
        _req: ChatCompletionRequest,
    ) -> Result<ChatCompletionResponse, InferenceError> {
        // Phase 1: implement via shared openai-compat helper (DeepSeek's API is
        // OpenAI-compatible; only the base URL and key differ).
        unimplemented!("DeepSeek adapter not yet wired — Phase 1 build follow-up")
    }

    async fn chat_completion_stream(
        &self,
        _req: ChatCompletionRequest,
    ) -> Result<BoxStream<'static, Result<ChatCompletionChunk, InferenceError>>, InferenceError>
    {
        // Phase 1: share SSE streaming logic with openai adapter.
        unimplemented!("DeepSeek streaming adapter not yet wired — Phase 1 build follow-up")
    }
}
