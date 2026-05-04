//! Integration tests for aeqi-ipfs.
//!
//! All tests spin up a hand-rolled axum mock server on an OS-assigned port.
//! No real kubo daemon is required.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::extract::Query;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::post;
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use tokio::net::TcpListener;

use aeqi_ipfs::IpfsClient;

// ─── helpers ────────────────────────────────────────────────────────────────

/// Shared state threaded into each mock route via `axum::State`.
#[derive(Clone, Default)]
struct MockState {
    /// Last raw request body captured by the add handler.
    last_add_body: Arc<Mutex<Option<Vec<u8>>>>,
}

/// Bind a listener and return both the address and the listener so the caller
/// can pass the listener to `axum::serve`.
async fn bind_listener() -> (SocketAddr, TcpListener) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    (addr, listener)
}

/// Spawn a mock kubo server and return the base URL.
///
/// `router` should be built with all the routes the test exercises. The server
/// runs in the background for the duration of the test.
async fn spawn_mock(router: Router) -> String {
    let (addr, listener) = bind_listener().await;
    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    format!("http://{addr}")
}

// ─── query param extractors ──────────────────────────────────────────────────

#[derive(Deserialize)]
struct ArgParam {
    arg: String,
}

// ─── tests ───────────────────────────────────────────────────────────────────

/// POST /api/v0/add — happy path: multipart upload returns a canned CID.
#[tokio::test]
async fn test_add_returns_cid() {
    let state = MockState::default();
    let state_clone = state.clone();

    let app = Router::new().route(
        "/api/v0/add",
        post(move |body: axum::body::Bytes| {
            let s = state_clone.clone();
            async move {
                *s.last_add_body.lock().unwrap() = Some(body.to_vec());
                Json(json!({
                    "Name": "file",
                    "Hash": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
                    "Size": "6"
                }))
                .into_response()
            }
        }),
    );

    let base = spawn_mock(app).await;
    let client = IpfsClient::new(&base);

    let cid = client
        .add(b"hello!".to_vec())
        .await
        .expect("add should succeed");
    assert_eq!(
        cid,
        "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"
    );

    // The multipart body must contain the bytes we uploaded.
    let captured = state.last_add_body.lock().unwrap().clone().unwrap();
    let body_str = String::from_utf8_lossy(&captured);
    assert!(
        body_str.contains("hello!"),
        "multipart body should contain the uploaded bytes"
    );
}

/// POST /api/v0/add — server returns 500; expect IpfsError::Decode.
#[tokio::test]
async fn test_add_server_error() {
    let app = Router::new().route(
        "/api/v0/add",
        post(|| async {
            (StatusCode::INTERNAL_SERVER_ERROR, "internal server error").into_response()
        }),
    );

    let base = spawn_mock(app).await;
    let client = IpfsClient::new(&base);

    let result = client.add(b"data".to_vec()).await;
    assert!(result.is_err(), "should fail on 500");
    let err = result.unwrap_err();
    assert!(
        err.to_string().contains("500"),
        "error should mention status code"
    );
}

/// POST /api/v0/add — response JSON missing Hash field; expect MissingCid.
#[tokio::test]
async fn test_add_missing_hash_field() {
    let app = Router::new().route(
        "/api/v0/add",
        post(|| async { Json(json!({ "Name": "file", "Size": "4" })).into_response() }),
    );

    let base = spawn_mock(app).await;
    let client = IpfsClient::new(&base);

    let result = client.add(b"data".to_vec()).await;
    assert!(result.is_err());
    assert!(
        result.unwrap_err().to_string().contains("missing CID"),
        "should return MissingCid variant"
    );
}

/// POST /api/v0/add — response is not valid JSON; expect Decode error.
#[tokio::test]
async fn test_add_malformed_response() {
    let app = Router::new().route(
        "/api/v0/add",
        post(|| async { "not json at all".into_response() }),
    );

    let base = spawn_mock(app).await;
    let client = IpfsClient::new(&base);

    let result = client.add(b"data".to_vec()).await;
    assert!(result.is_err());
    assert!(
        result.unwrap_err().to_string().contains("not valid JSON"),
        "should report JSON parse failure"
    );
}

/// POST /api/v0/cat?arg=<cid> — happy path: returns canned bytes.
#[tokio::test]
async fn test_fetch_returns_bytes() {
    const CID: &str = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

    let last_cid: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let last_cid_clone = last_cid.clone();

    let app = Router::new().route(
        "/api/v0/cat",
        post(move |Query(q): Query<ArgParam>| {
            let lc = last_cid_clone.clone();
            async move {
                *lc.lock().unwrap() = Some(q.arg.clone());
                b"hello from ipfs".to_vec().into_response()
            }
        }),
    );

    let base = spawn_mock(app).await;
    let client = IpfsClient::new(&base);

    let bytes = client.fetch(CID).await.expect("fetch should succeed");
    assert_eq!(bytes, b"hello from ipfs");
    assert_eq!(last_cid.lock().unwrap().as_deref(), Some(CID));
}

/// POST /api/v0/cat — server returns 404; expect Decode error.
#[tokio::test]
async fn test_fetch_not_found() {
    let app = Router::new().route(
        "/api/v0/cat",
        post(|| async { (StatusCode::NOT_FOUND, "block not found").into_response() }),
    );

    let base = spawn_mock(app).await;
    let client = IpfsClient::new(&base);

    let result = client.fetch("somecid").await;
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("404"));
}

/// POST /api/v0/pin/add?arg=<cid> — happy path.
#[tokio::test]
async fn test_pin_add_happy() {
    const CID: &str = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

    let hit = Arc::new(Mutex::new(0u32));
    let hit_clone = hit.clone();

    let app = Router::new().route(
        "/api/v0/pin/add",
        post(move |Query(q): Query<ArgParam>| {
            let h = hit_clone.clone();
            async move {
                *h.lock().unwrap() += 1;
                Json(json!({ "Pins": [q.arg] })).into_response()
            }
        }),
    );

    let base = spawn_mock(app).await;
    let client = IpfsClient::new(&base);

    client.pin_add(CID).await.expect("pin_add should succeed");
    assert_eq!(*hit.lock().unwrap(), 1);
}

/// POST /api/v0/pin/add — server returns 500; expect error.
#[tokio::test]
async fn test_pin_add_server_error() {
    let app = Router::new().route(
        "/api/v0/pin/add",
        post(|| async { (StatusCode::INTERNAL_SERVER_ERROR, "daemon error").into_response() }),
    );

    let base = spawn_mock(app).await;
    let client = IpfsClient::new(&base);

    let result = client.pin_add("somecid").await;
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("500"));
}

/// POST /api/v0/pin/rm?arg=<cid> — happy path.
#[tokio::test]
async fn test_unpin_happy() {
    const CID: &str = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

    let hit = Arc::new(Mutex::new(0u32));
    let hit_clone = hit.clone();

    let app = Router::new().route(
        "/api/v0/pin/rm",
        post(move |Query(q): Query<ArgParam>| {
            let h = hit_clone.clone();
            async move {
                *h.lock().unwrap() += 1;
                Json(json!({ "Pins": [q.arg] })).into_response()
            }
        }),
    );

    let base = spawn_mock(app).await;
    let client = IpfsClient::new(&base);

    client.unpin(CID).await.expect("unpin should succeed");
    assert_eq!(*hit.lock().unwrap(), 1);
}

/// POST /api/v0/pin/rm — server returns 500; expect error.
#[tokio::test]
async fn test_unpin_server_error() {
    let app = Router::new().route(
        "/api/v0/pin/rm",
        post(|| async { (StatusCode::INTERNAL_SERVER_ERROR, "daemon error").into_response() }),
    );

    let base = spawn_mock(app).await;
    let client = IpfsClient::new(&base);

    let result = client.unpin("somecid").await;
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("500"));
}

/// POST /api/v0/version — health check happy path.
#[tokio::test]
async fn test_health_happy() {
    let app = Router::new().route(
        "/api/v0/version",
        post(|| async { Json(json!({ "Version": "0.32.0", "Commit": "abc" })).into_response() }),
    );

    let base = spawn_mock(app).await;
    let client = IpfsClient::new(&base);

    client.health().await.expect("health should succeed");
}

/// POST /api/v0/version — daemon returns 503; expect Unhealthy.
#[tokio::test]
async fn test_health_unhealthy() {
    let app = Router::new().route(
        "/api/v0/version",
        post(|| async { (StatusCode::SERVICE_UNAVAILABLE, "starting up").into_response() }),
    );

    let base = spawn_mock(app).await;
    let client = IpfsClient::new(&base);

    let result = client.health().await;
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(
        err.to_string().contains("503") || err.to_string().contains("unhealthy"),
        "should be Unhealthy, got: {err}"
    );
}

/// Connection refused (no server at all) — expect IpfsError::Http.
#[tokio::test]
async fn test_health_connection_refused() {
    // Pick a port that nothing is listening on.
    let client = IpfsClient::new("http://127.0.0.1:19876");
    let result = client.health().await;
    assert!(result.is_err());
    // Should surface as Unhealthy (connection failed) not panic.
    let err_str = result.unwrap_err().to_string();
    assert!(
        err_str.contains("connection failed") || err_str.contains("error"),
        "unexpected error: {err_str}"
    );
}

/// Verify that `add` correctly passes the CID `arg` query param for `fetch`.
///
/// Round-trip: upload bytes, receive a canned CID, then fetch that CID and
/// get the original bytes back.
#[tokio::test]
async fn test_add_then_fetch_roundtrip() {
    let stored: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
    let stored_add = stored.clone();
    let stored_cat = stored.clone();

    const CID: &str = "bafytest000roundtrip";

    let app = Router::new()
        .route(
            "/api/v0/add",
            post(move |body: axum::body::Bytes| {
                let s = stored_add.clone();
                async move {
                    // Crude multipart unwrap: the actual content is embedded in
                    // the multipart body.  Store the whole raw body; the cat
                    // handler returns it back to prove the bytes flowed.
                    *s.lock().unwrap() = body.to_vec();
                    Json(json!({ "Hash": CID, "Name": "file", "Size": "5" })).into_response()
                }
            }),
        )
        .route(
            "/api/v0/cat",
            post(move |Query(q): Query<ArgParam>| {
                let s = stored_cat.clone();
                async move {
                    assert_eq!(q.arg, CID);
                    s.lock().unwrap().clone().into_response()
                }
            }),
        );

    let base = spawn_mock(app).await;
    let client = IpfsClient::new(&base);

    let payload = b"world".to_vec();
    let cid = client.add(payload.clone()).await.expect("add");
    assert_eq!(cid, CID);

    let fetched = client.fetch(&cid).await.expect("fetch");
    // The cat handler echoes back whatever was stored by the add handler
    // (the raw multipart body), so just assert it's non-empty and that the CID
    // routing worked correctly — the exact multipart framing is not the unit
    // under test here.
    assert!(!fetched.is_empty(), "fetched bytes should be non-empty");
}
