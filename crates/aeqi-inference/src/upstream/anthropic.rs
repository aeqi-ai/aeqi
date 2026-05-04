//! Anthropic upstream adapter stub.
//!
//! Handles models whose prefix resolves to `"claude"` — e.g.
//! `claude-sonnet-4-6`, `claude-opus-4`.
//!
//! **Phase 1 TODO (wire this first — it's the primary agent model):**
//! - POST `https://api.anthropic.com/v1/messages` with
//!   `x-api-key: <key>` and `anthropic-version: 2023-06-01`.
//! - Transform `ChatCompletionRequest.messages` → Anthropic's
//!   `messages` array (role mapping: `system` → top-level `system` param,
//!   `user`/`assistant` → messages array).
//! - Parse streaming `text_delta` events into `ChatCompletionChunk`.
//! - Map `input_tokens` + `output_tokens` from the `message_delta` stop event
//!   back to `UsageStats` for billing.
//! - Note: `max_tokens` is required in Anthropic API; default to 4096 if not set.

use async_trait::async_trait;
use futures::stream::BoxStream;

use crate::{
    error::InferenceError,
    router::UpstreamProvider,
    types::{ChatCompletionChunk, ChatCompletionRequest, ChatCompletionResponse},
};

/// Anthropic Messages API adapter.
///
/// Phase 1: add `api_key: String` field; read from env `ANTHROPIC_API_KEY`.
#[derive(Clone, Debug, Default)]
pub struct AnthropicProvider;

impl AnthropicProvider {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl UpstreamProvider for AnthropicProvider {
    async fn chat_completion(
        &self,
        _req: ChatCompletionRequest,
    ) -> Result<ChatCompletionResponse, InferenceError> {
        // Phase 1: implement real Anthropic HTTP call.
        unimplemented!("Anthropic adapter not yet wired — Phase 1 build follow-up")
    }

    async fn chat_completion_stream(
        &self,
        _req: ChatCompletionRequest,
    ) -> Result<BoxStream<'static, Result<ChatCompletionChunk, InferenceError>>, InferenceError>
    {
        // Phase 1: implement SSE streaming via reqwest + async-stream.
        unimplemented!("Anthropic streaming adapter not yet wired — Phase 1 build follow-up")
    }
}
