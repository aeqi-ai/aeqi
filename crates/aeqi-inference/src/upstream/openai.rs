//! OpenAI upstream adapter stub.
//!
//! Handles models whose prefix resolves to `"gpt"` — e.g. `gpt-5`, `gpt-4o`.
//!
//! **Phase 1 TODO:**
//! - POST `https://api.openai.com/v1/chat/completions` with `Authorization: Bearer <key>`.
//! - Parse streaming SSE response into `ChatCompletionChunk` via `async-stream`.
//! - Map provider errors (rate limit, context-length exceeded, etc.) to `InferenceError`.
//! - Thread `usage` stats from the `[DONE]` SSE sentinel back to the billing handler.

use async_trait::async_trait;
use futures::stream::BoxStream;

use crate::{
    error::InferenceError,
    router::UpstreamProvider,
    types::{ChatCompletionChunk, ChatCompletionRequest, ChatCompletionResponse},
};

/// OpenAI API adapter.
///
/// Cheap to clone — `reqwest::Client` is `Arc`-backed internally.
/// Phase 1: add `api_key: String` field; read from env `OPENAI_API_KEY`.
#[derive(Clone, Debug, Default)]
pub struct OpenAiProvider;

impl OpenAiProvider {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl UpstreamProvider for OpenAiProvider {
    async fn chat_completion(
        &self,
        _req: ChatCompletionRequest,
    ) -> Result<ChatCompletionResponse, InferenceError> {
        // Phase 1: implement real OpenAI HTTP call.
        unimplemented!("OpenAI adapter not yet wired — Phase 1 build follow-up")
    }

    async fn chat_completion_stream(
        &self,
        _req: ChatCompletionRequest,
    ) -> Result<BoxStream<'static, Result<ChatCompletionChunk, InferenceError>>, InferenceError>
    {
        // Phase 1: implement SSE streaming via reqwest byte stream + async-stream.
        unimplemented!("OpenAI streaming adapter not yet wired — Phase 1 build follow-up")
    }
}
