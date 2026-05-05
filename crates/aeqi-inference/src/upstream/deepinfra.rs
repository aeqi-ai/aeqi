//! DeepInfra upstream provider — OpenAI-compatible endpoint.
//!
//! Handles models from the DeepInfra whitelist (see [`ALLOWED_MODELS`]).
//! The prefix registered in the router table is `"meta-llama"`, `"mistralai"`,
//! `"Qwen"`, and `"deepinfra"` — but routing into this provider is done by
//! exact model match via the router's model-prefix lookup. Because DeepInfra
//! model IDs contain forward slashes (`meta-llama/Meta-Llama-3.1-70B-Instruct`)
//! the caller strips the slash-prefix via [`model_prefix`] before dispatch.
//!
//! API key is read from `DEEPINFRA_API_KEY` env var at construction time.
//! The request panics at startup (not at call time) if the key is absent when
//! the provider is actively registered in the router — that's intentional.
//! In test mode, override with a fake key.

use async_stream::try_stream;
use async_trait::async_trait;
use futures::stream::BoxStream;
use reqwest::Client;
use serde_json::json;
use tracing::debug;

use crate::{
    error::InferenceError,
    router::UpstreamProvider,
    types::{
        ChatChoice, ChatCompletionChunk, ChatCompletionRequest, ChatCompletionResponse,
        ChatMessage, ChunkChoice, ChunkDelta, UsageStats,
    },
};

/// DeepInfra base URL — OpenAI-compatible.
pub const DEEPINFRA_BASE_URL: &str = "https://api.deepinfra.com/v1/openai";

/// Model IDs supported by this provider.
/// Any model not in this list is rejected with [`InferenceError::Unsupported`].
pub const ALLOWED_MODELS: &[&str] = &[
    "meta-llama/Meta-Llama-3.1-70B-Instruct",
    "meta-llama/Meta-Llama-3.1-8B-Instruct",
    "meta-llama/Meta-Llama-3.3-70B-Instruct",
    "mistralai/Mistral-7B-Instruct-v0.3",
    "Qwen/Qwen2.5-72B-Instruct",
    "deepinfra/airoboros-70b",
];

/// Static price table — dollars per million tokens (input / output).
/// Source: DeepInfra pricing page accessed 2026-05-05.
#[derive(Debug, Clone, Copy)]
pub struct ModelPricing {
    /// Cost per 1 million input (prompt) tokens, USD.
    pub input_per_million: f64,
    /// Cost per 1 million output (completion) tokens, USD.
    pub output_per_million: f64,
}

/// Look up pricing for `model`. Returns `None` for unknown models.
pub fn pricing_for(model: &str) -> Option<ModelPricing> {
    match model {
        "meta-llama/Meta-Llama-3.1-70B-Instruct" => Some(ModelPricing {
            input_per_million: 0.59,
            output_per_million: 0.79,
        }),
        "meta-llama/Meta-Llama-3.1-8B-Instruct" => Some(ModelPricing {
            input_per_million: 0.055,
            output_per_million: 0.055,
        }),
        "meta-llama/Meta-Llama-3.3-70B-Instruct" => Some(ModelPricing {
            input_per_million: 0.59,
            output_per_million: 0.79,
        }),
        "mistralai/Mistral-7B-Instruct-v0.3" => Some(ModelPricing {
            input_per_million: 0.055,
            output_per_million: 0.055,
        }),
        "Qwen/Qwen2.5-72B-Instruct" => Some(ModelPricing {
            input_per_million: 0.35,
            output_per_million: 0.40,
        }),
        "deepinfra/airoboros-70b" => Some(ModelPricing {
            input_per_million: 0.70,
            output_per_million: 0.70,
        }),
        _ => None,
    }
}

/// Convert token counts to USD cost in micro-dollars (1e-6 USD), truncated.
///
/// Returns `0` if the model has no price entry (unknown model fallthrough).
pub fn compute_cost_microdollars(model: &str, prompt_tokens: u32, completion_tokens: u32) -> u64 {
    let Some(p) = pricing_for(model) else {
        return 0;
    };
    let input_cost = p.input_per_million * prompt_tokens as f64 / 1_000_000.0;
    let output_cost = p.output_per_million * completion_tokens as f64 / 1_000_000.0;
    ((input_cost + output_cost) * 1_000_000.0) as u64
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/// DeepInfra provider adapter.
///
/// Reads `DEEPINFRA_API_KEY` from env at construction. Registers in the
/// router for model prefix `"meta-llama"` / `"mistralai"` / `"Qwen"` /
/// `"deepinfra"` — however, because all DeepInfra model IDs contain `/`,
/// the router wraps them under a single `"deepinfra"` registry key and
/// the handler validates the exact model against [`ALLOWED_MODELS`].
pub struct DeepInfraProvider {
    api_key: String,
    client: Client,
    /// Override base URL for testing (points to wiremock server).
    base_url: String,
}

impl DeepInfraProvider {
    /// Construct from `DEEPINFRA_API_KEY` env var.
    ///
    /// Panics if the env var is absent — fail loudly at startup rather than
    /// at the first call.
    pub fn from_env() -> Self {
        let api_key = std::env::var("DEEPINFRA_API_KEY")
            .expect("DEEPINFRA_API_KEY must be set to activate DeepInfraProvider");
        Self::with_key(api_key)
    }

    /// Construct with an explicit API key (used in tests with fake key).
    pub fn with_key(api_key: impl Into<String>) -> Self {
        Self {
            api_key: api_key.into(),
            client: Client::new(),
            base_url: DEEPINFRA_BASE_URL.to_owned(),
        }
    }

    /// Override the base URL. Used in integration tests against a mock server.
    ///
    /// Not gated by `#[cfg(test)]` because integration tests are compiled as
    /// a separate binary and cannot see `#[cfg(test)]` items from the crate.
    pub fn with_base_url(mut self, base_url: impl Into<String>) -> Self {
        self.base_url = base_url.into();
        self
    }

    fn validate_model(&self, model: &str) -> Result<(), InferenceError> {
        if ALLOWED_MODELS.contains(&model) {
            Ok(())
        } else {
            Err(InferenceError::Unsupported(format!(
                "model '{model}' is not in the DeepInfra whitelist"
            )))
        }
    }
}

#[async_trait]
impl UpstreamProvider for DeepInfraProvider {
    async fn chat_completion(
        &self,
        req: ChatCompletionRequest,
    ) -> Result<ChatCompletionResponse, InferenceError> {
        self.validate_model(&req.model)?;

        let url = format!("{}/chat/completions", self.base_url);
        debug!(model = req.model, url, "deepinfra non-streaming call");

        let body = build_request_body(&req, false);

        let resp = self
            .client
            .post(&url)
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| InferenceError::UpstreamUnavailable(e.to_string()))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(InferenceError::UpstreamUnavailable(format!(
                "DeepInfra returned {status}: {text}"
            )));
        }

        let raw: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| InferenceError::Internal(e.to_string()))?;

        parse_chat_response(&raw, &req.model)
    }

    async fn chat_completion_stream(
        &self,
        req: ChatCompletionRequest,
    ) -> Result<BoxStream<'static, Result<ChatCompletionChunk, InferenceError>>, InferenceError>
    {
        self.validate_model(&req.model)?;

        let url = format!("{}/chat/completions", self.base_url);
        debug!(model = req.model, url, "deepinfra streaming call");

        let body = build_request_body(&req, true);

        let resp = self
            .client
            .post(&url)
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| InferenceError::UpstreamUnavailable(e.to_string()))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(InferenceError::UpstreamUnavailable(format!(
                "DeepInfra returned {status}: {text}"
            )));
        }

        // Parse SSE stream from the response body.
        let model = req.model.clone();
        let stream = try_stream! {
            use futures::StreamExt;
            let mut byte_stream = resp.bytes_stream();
            let mut buf = String::new();

            while let Some(chunk) = byte_stream.next().await {
                let bytes = chunk.map_err(|e| InferenceError::UpstreamUnavailable(e.to_string()))?;
                buf.push_str(&String::from_utf8_lossy(&bytes));

                // SSE lines are separated by "\n". Each SSE event starts with "data: ".
                while let Some(newline_pos) = buf.find('\n') {
                    let line = buf[..newline_pos].trim_end_matches('\r').to_owned();
                    buf = buf[newline_pos + 1..].to_owned();

                    if line.is_empty() {
                        continue;
                    }
                    let data = if let Some(d) = line.strip_prefix("data: ") {
                        d
                    } else {
                        continue;
                    };
                    if data == "[DONE]" {
                        return;
                    }
                    let chunk_val: serde_json::Value = serde_json::from_str(data)
                        .map_err(|e| InferenceError::Internal(format!("SSE parse: {e}")))?;
                    let chunk = parse_chunk(&chunk_val, &model)?;
                    yield chunk;
                }
            }
        };

        Ok(Box::pin(stream))
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn build_request_body(req: &ChatCompletionRequest, stream: bool) -> serde_json::Value {
    let mut body = json!({
        "model": req.model,
        "messages": req.messages.iter().map(|m| json!({
            "role": m.role,
            "content": m.content,
        })).collect::<Vec<_>>(),
        "stream": stream,
    });

    if let Some(mt) = req.max_tokens {
        body["max_tokens"] = json!(mt);
    }
    if let Some(t) = req.temperature {
        body["temperature"] = json!(t);
    }

    body
}

fn parse_chat_response(
    raw: &serde_json::Value,
    model: &str,
) -> Result<ChatCompletionResponse, InferenceError> {
    let id = raw["id"].as_str().unwrap_or("").to_owned();
    let created = raw["created"].as_i64().unwrap_or(0);

    let choices = raw["choices"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .enumerate()
                .map(|(i, c)| ChatChoice {
                    index: i as u32,
                    message: ChatMessage {
                        role: c["message"]["role"]
                            .as_str()
                            .unwrap_or("assistant")
                            .to_owned(),
                        content: c["message"]["content"].as_str().unwrap_or("").to_owned(),
                    },
                    finish_reason: c["finish_reason"].as_str().map(|s| s.to_owned()),
                })
                .collect()
        })
        .unwrap_or_default();

    let usage = raw["usage"].as_object().map(|u| UsageStats {
        prompt_tokens: u["prompt_tokens"].as_u64().unwrap_or(0) as u32,
        completion_tokens: u["completion_tokens"].as_u64().unwrap_or(0) as u32,
        total_tokens: u["total_tokens"].as_u64().unwrap_or(0) as u32,
    });

    Ok(ChatCompletionResponse {
        id,
        object: "chat.completion".to_owned(),
        created,
        model: model.to_owned(),
        choices,
        usage,
    })
}

fn parse_chunk(
    raw: &serde_json::Value,
    model: &str,
) -> Result<ChatCompletionChunk, InferenceError> {
    let id = raw["id"].as_str().unwrap_or("").to_owned();
    let created = raw["created"].as_i64().unwrap_or(0);

    let choices = raw["choices"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .enumerate()
                .map(|(i, c)| ChunkChoice {
                    index: i as u32,
                    delta: ChunkDelta {
                        role: c["delta"]["role"].as_str().map(|s| s.to_owned()),
                        content: c["delta"]["content"].as_str().map(|s| s.to_owned()),
                    },
                    finish_reason: c["finish_reason"].as_str().map(|s| s.to_owned()),
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(ChatCompletionChunk {
        id,
        object: "chat.completion.chunk".to_owned(),
        created,
        model: model.to_owned(),
        choices,
    })
}
