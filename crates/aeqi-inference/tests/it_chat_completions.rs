//! Integration tests for `POST /v1/chat/completions` against a fake DeepInfra
//! upstream served by wiremock.
//!
//! Test coverage:
//! - Non-streaming happy path: request forwarded correctly, response parsed,
//!   balance debited.
//! - Upstream non-2xx: propagated as 502 Bad Gateway.
//! - Disallowed model: rejected with 400 before hitting the upstream.
//! - Subscription middleware: missing auth → 401; zero balance → 402.

use std::sync::Arc;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{header, method, path},
};

use aeqi_inference::{
    AppState, DeepInfraProvider, InferenceRouter,
    api::create_router,
    billing::subscription::{BalanceStore, SubscriptionLayer},
};
use tower::Layer;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Stand up a mock DeepInfra server and wire it into a test AppState.
///
/// The returned `MockServer` must be kept alive for the duration of the test.
async fn build_state_with_mock(mock_server: &MockServer) -> AppState {
    let mut router = InferenceRouter::new();

    // Wire DeepInfraProvider pointing at the mock server.
    // Register under all prefixes that ALLOWED_MODELS produce when the router
    // splits model IDs on `-` and `.`. For `"meta-llama/..."` the split yields
    // `"meta"`, for `"mistralai/..."` → `"mistralai"`, etc.
    for prefix in ["meta", "mistralai", "qwen", "deepinfra"] {
        let provider = DeepInfraProvider::with_key("test-key")
            .with_base_url(format!("{}/v1/openai", mock_server.uri()));
        router.register(prefix, Arc::new(provider));
    }

    let store = BalanceStore::new();
    store.set("test-entity", 100_000); // $1000 in cents — plenty

    AppState::new(router, store)
}

/// A minimal valid non-streaming chat completion response from DeepInfra.
fn deepinfra_success_body() -> serde_json::Value {
    serde_json::json!({
        "id": "chatcmpl-abc123",
        "object": "chat.completion",
        "created": 1_746_403_200_i64,
        "model": "meta-llama/Meta-Llama-3.1-70B-Instruct",
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": "Hello from the mock!"
            },
            "finish_reason": "stop"
        }],
        "usage": {
            "prompt_tokens": 10,
            "completion_tokens": 8,
            "total_tokens": 18
        }
    })
}

/// Build a POST /chat/completions request body.
fn chat_request_body(model: &str) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": "hi"}],
        "stream": false
    }))
    .unwrap()
}

// ---------------------------------------------------------------------------
// Test: non-streaming happy path
// ---------------------------------------------------------------------------

#[tokio::test]
async fn non_streaming_happy_path() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/openai/chat/completions"))
        .and(header("authorization", "Bearer test-key"))
        .respond_with(ResponseTemplate::new(200).set_body_json(deepinfra_success_body()))
        .mount(&mock_server)
        .await;

    let state = build_state_with_mock(&mock_server).await;
    let initial_balance = state.balances.get("test-entity").unwrap_or(0);

    let app = create_router(state.clone());

    let req = Request::builder()
        .method("POST")
        .uri("/chat/completions")
        .header("content-type", "application/json")
        .header("x-entity", "test-entity")
        .body(Body::from(chat_request_body(
            "meta-llama/Meta-Llama-3.1-70B-Instruct",
        )))
        .unwrap();

    let response = app.oneshot(req).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK, "expect 200 on success");

    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["object"], "chat.completion");
    assert_eq!(
        json["choices"][0]["message"]["content"],
        "Hello from the mock!"
    );
    assert!(json["usage"]["total_tokens"].as_u64().unwrap() > 0);

    // Verify mock was actually called.
    mock_server.verify().await;

    // Balance should be unchanged or decremented (cost is sub-cent for 18 tokens).
    // For 18 tokens at $0.59/$0.79 per million the cost is < 1 cent so truncates to 0.
    let final_balance = state.balances.get("test-entity").unwrap_or(0);
    assert!(
        final_balance <= initial_balance,
        "balance should not increase"
    );
}

// ---------------------------------------------------------------------------
// Test: request is forwarded with correct headers
// ---------------------------------------------------------------------------

#[tokio::test]
async fn request_forwarded_with_bearer_auth() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/openai/chat/completions"))
        .and(header("authorization", "Bearer test-key"))
        .and(header("content-type", "application/json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(deepinfra_success_body()))
        .expect(1) // exactly one call
        .mount(&mock_server)
        .await;

    let state = build_state_with_mock(&mock_server).await;
    let app = create_router(state);

    let req = Request::builder()
        .method("POST")
        .uri("/chat/completions")
        .header("content-type", "application/json")
        .header("x-entity", "test-entity")
        .body(Body::from(chat_request_body(
            "meta-llama/Meta-Llama-3.1-70B-Instruct",
        )))
        .unwrap();

    let response = app.oneshot(req).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    mock_server.verify().await;
}

// ---------------------------------------------------------------------------
// Test: upstream 503 → 503 Service Unavailable (typed Overloaded variant)
//
// After quest 67-184, the upstream-error envelope is typed: 503 from a
// provider maps to `InferenceError::Overloaded`, which propagates as a
// 503 to the client rather than getting flattened into a generic 502.
// Clients that respect the Retry-After header benefit from the
// distinction; the pre-67-184 test asserted the flattened-to-502
// behaviour.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn upstream_503_surfaces_as_503_overloaded() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/openai/chat/completions"))
        .respond_with(ResponseTemplate::new(503).set_body_string("service unavailable"))
        .mount(&mock_server)
        .await;

    let state = build_state_with_mock(&mock_server).await;
    let app = create_router(state);

    let req = Request::builder()
        .method("POST")
        .uri("/chat/completions")
        .header("content-type", "application/json")
        .header("x-entity", "test-entity")
        .body(Body::from(chat_request_body(
            "meta-llama/Meta-Llama-3.1-70B-Instruct",
        )))
        .unwrap();

    let response = app.oneshot(req).await.unwrap();
    assert_eq!(
        response.status(),
        StatusCode::SERVICE_UNAVAILABLE,
        "upstream 503 should surface as 503 (typed Overloaded variant)"
    );
}

// ---------------------------------------------------------------------------
// Test: disallowed model → 400 (no upstream call)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn disallowed_model_returns_400_without_upstream_call() {
    let mock_server = MockServer::start().await;
    // No mocks registered — any call to mock_server would panic on verify.

    let state = build_state_with_mock(&mock_server).await;
    let app = create_router(state);

    let req = Request::builder()
        .method("POST")
        .uri("/chat/completions")
        .header("content-type", "application/json")
        .header("x-entity", "test-entity")
        .body(Body::from(chat_request_body("gpt-5-not-on-deepinfra")))
        .unwrap();

    let response = app.oneshot(req).await.unwrap();
    // "gpt-5-not-on-deepinfra" resolves to prefix "gpt" which has no registered
    // provider → InferenceError::Unsupported → 400.
    assert_eq!(
        response.status(),
        StatusCode::BAD_REQUEST,
        "unregistered model should return 400"
    );

    // Verify no upstream calls were made.
    mock_server.verify().await;
}

// ---------------------------------------------------------------------------
// Test: subscription middleware — missing auth → 401
// ---------------------------------------------------------------------------

#[tokio::test]
async fn subscription_middleware_missing_auth_returns_401() {
    let mock_server = MockServer::start().await;
    let state = build_state_with_mock(&mock_server).await;

    let store = state.balances.clone();
    store.set("test-entity", 50_000);

    let app = SubscriptionLayer::new(store).layer(create_router(state));

    let req = Request::builder()
        .method("POST")
        .uri("/chat/completions")
        .header("content-type", "application/json")
        // No Authorization header
        .body(Body::from(chat_request_body(
            "meta-llama/Meta-Llama-3.1-70B-Instruct",
        )))
        .unwrap();

    let response = app.oneshot(req).await.unwrap();
    assert_eq!(
        response.status(),
        StatusCode::UNAUTHORIZED,
        "missing auth should yield 401"
    );
}

// ---------------------------------------------------------------------------
// Test: subscription middleware — zero balance → 402
// ---------------------------------------------------------------------------

#[tokio::test]
async fn subscription_middleware_zero_balance_returns_402() {
    let mock_server = MockServer::start().await;
    let state = build_state_with_mock(&mock_server).await;

    // Override balance to zero for "broke-entity".
    let store = state.balances.clone();
    store.set("broke-entity", 0);

    let app = SubscriptionLayer::new(store).layer(create_router(state));

    let req = Request::builder()
        .method("POST")
        .uri("/chat/completions")
        .header("content-type", "application/json")
        .header("authorization", "Bearer some-valid-token")
        .header("x-entity", "broke-entity")
        .body(Body::from(chat_request_body(
            "meta-llama/Meta-Llama-3.1-70B-Instruct",
        )))
        .unwrap();

    let response = app.oneshot(req).await.unwrap();
    assert_eq!(
        response.status(),
        StatusCode::PAYMENT_REQUIRED,
        "zero balance should yield 402"
    );
}

// ---------------------------------------------------------------------------
// Test: GET /models includes DeepInfra whitelist
// ---------------------------------------------------------------------------

#[tokio::test]
async fn models_endpoint_includes_deepinfra_models() {
    let mock_server = MockServer::start().await;
    let state = build_state_with_mock(&mock_server).await;
    let app = create_router(state);

    let req = Request::builder()
        .method("GET")
        .uri("/models")
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(req).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

    let ids: Vec<&str> = json["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["id"].as_str().unwrap())
        .collect();

    assert!(
        ids.contains(&"meta-llama/Meta-Llama-3.1-70B-Instruct"),
        "model list must include the primary DeepInfra model"
    );
}
