//! Model → upstream provider routing table.
//!
//! The `UpstreamProvider` trait is what each provider adapter must implement.
//! The `Router` struct holds the dispatch table keyed by model prefix and
//! forwards `ChatCompletionRequest`s to the right adapter.
//!
//! Phase 1 build: wire `OpenAiProvider`, `AnthropicProvider`, `DeepSeekProvider`
//! into the registry below.

use std::{collections::HashMap, sync::Arc};

use async_trait::async_trait;
use futures::stream::BoxStream;

use crate::{
    error::InferenceError,
    types::{ChatCompletionChunk, ChatCompletionRequest, ChatCompletionResponse},
};

/// Trait every upstream provider adapter must implement.
///
/// Both methods must be `Send + Sync`-safe because they are invoked from
/// async axum handlers behind a shared `Arc`.
///
/// Phase 1 implementation note: start with `chat_completion` (non-streaming)
/// to prove end-to-end billing, then add `chat_completion_stream` once SSE
/// plumbing is validated.
#[async_trait]
pub trait UpstreamProvider: Send + Sync {
    /// Non-streaming chat completion.
    async fn chat_completion(
        &self,
        req: ChatCompletionRequest,
    ) -> Result<ChatCompletionResponse, InferenceError>;

    /// Streaming chat completion — yields SSE chunks until `finish_reason` is set.
    async fn chat_completion_stream(
        &self,
        req: ChatCompletionRequest,
    ) -> Result<BoxStream<'static, Result<ChatCompletionChunk, InferenceError>>, InferenceError>;
}

/// Dispatches incoming requests to the correct upstream provider.
///
/// The dispatch table is keyed by *model prefix* (the part before the first
/// `-` or `.`), so `"gpt-5"` → `"gpt"`, `"claude-sonnet-4-6"` → `"claude"`,
/// `"deepseek-v4"` → `"deepseek"`, `"llama-4-large"` → `"llama"`.
///
/// Build the router with [`Router::new`] and register providers via
/// [`Router::register`]. Unknown models return
/// [`InferenceError::Unsupported`].
pub struct Router {
    /// Map from model-prefix (e.g. `"gpt"`) to the provider that handles it.
    providers: HashMap<String, Arc<dyn UpstreamProvider>>,
}

impl Router {
    /// Construct an empty router.
    pub fn new() -> Self {
        Self {
            providers: HashMap::new(),
        }
    }

    /// Register `provider` for all models whose ID starts with `prefix`.
    ///
    /// Example:
    /// ```ignore
    /// router.register("gpt", Arc::new(OpenAiProvider::new(api_key)));
    /// router.register("claude", Arc::new(AnthropicProvider::new(api_key)));
    /// ```
    pub fn register(&mut self, prefix: impl Into<String>, provider: Arc<dyn UpstreamProvider>) {
        self.providers.insert(prefix.into(), provider);
    }

    /// Resolve a model ID to its provider.
    fn resolve(&self, model: &str) -> Result<Arc<dyn UpstreamProvider>, InferenceError> {
        // Prefix = everything up to (but not including) the first `-` or `.`.
        let prefix = model.split(['-', '.']).next().unwrap_or(model);

        self.providers.get(prefix).cloned().ok_or_else(|| {
            InferenceError::Unsupported(format!("model '{model}' has no registered provider"))
        })
    }

    /// Forward a non-streaming completion request to the right provider.
    pub async fn chat_completion(
        &self,
        req: ChatCompletionRequest,
    ) -> Result<ChatCompletionResponse, InferenceError> {
        let provider = self.resolve(&req.model)?;
        provider.chat_completion(req).await
    }

    /// Forward a streaming completion request to the right provider.
    pub async fn chat_completion_stream(
        &self,
        req: ChatCompletionRequest,
    ) -> Result<BoxStream<'static, Result<ChatCompletionChunk, InferenceError>>, InferenceError>
    {
        let provider = self.resolve(&req.model)?;
        provider.chat_completion_stream(req).await
    }
}

impl Default for Router {
    fn default() -> Self {
        Self::new()
    }
}
