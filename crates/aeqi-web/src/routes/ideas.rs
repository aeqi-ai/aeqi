use axum::{
    Json, Router,
    extract::{Multipart, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use base64::Engine as _;
use serde::{Deserialize, Serialize};

use super::helpers::{ipc_proxy, merge_path_id, query_to_params};
use crate::extractors::Scope;
use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/ideas", get(list_ideas).post(store_idea))
        .route("/ideas/files", post(upload_root_idea_file))
        .route("/ideas/search", get(search_ideas))
        .route("/ideas/prefix", get(ideas_by_prefix))
        .route("/ideas/by-ids", post(ideas_by_ids))
        .route("/ideas/profile", get(idea_profile))
        .route("/ideas/graph", get(idea_graph))
        .route("/ideas/seed", post(seed_ideas))
        .route(
            "/ideas/{id}",
            axum::routing::put(update_idea).delete(delete_idea),
        )
        .route("/ideas/{id}/files", post(upload_child_idea_file))
        .route(
            "/ideas/{id}/edges",
            get(get_idea_edges)
                .post(add_idea_edge)
                .delete(remove_idea_edge),
        )
        .route("/ideas/{id}/activity", get(idea_activity))
        .route("/ideas/{id}/comments", get(idea_comments))
        .route("/ideas/{id}/subscribe", post(idea_subscribe))
        // Tables-in-Ideas Phase 2.
        .route("/ideas/{id}/children", get(list_idea_children))
        .route(
            "/ideas/{id}/properties",
            axum::routing::put(set_idea_properties),
        )
}

#[derive(Deserialize, Serialize, Default)]
struct ListIdeasQuery {
    agent_id: Option<String>,
}

async fn list_ideas(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<ListIdeasQuery>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "list_ideas", query_to_params(&q)).await
}

async fn store_idea(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "store_idea", body).await
}

async fn upload_root_idea_file(
    State(state): State<AppState>,
    scope: Scope,
    multipart: Multipart,
) -> Response {
    upload_idea_file(state, scope, None, multipart).await
}

async fn upload_child_idea_file(
    State(state): State<AppState>,
    scope: Scope,
    Path(parent_id): Path<String>,
    multipart: Multipart,
) -> Response {
    upload_idea_file(state, scope, Some(parent_id), multipart).await
}

async fn upload_idea_file(
    state: AppState,
    scope: Scope,
    parent_idea_id: Option<String>,
    mut multipart: Multipart,
) -> Response {
    let mut agent_id: Option<String> = None;
    let mut idea_scope: Option<String> = None;
    let mut file_name: Option<String> = None;
    let mut mime: Option<String> = None;
    let mut bytes: Option<Vec<u8>> = None;

    while let Some(field) = match multipart.next_field().await {
        Ok(field) => field,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"ok": false, "error": format!("invalid multipart body: {e}")})),
            )
                .into_response();
        }
    } {
        let field_name = field.name().unwrap_or("").to_string();
        if field_name == "agent_id" {
            agent_id = field.text().await.ok().map(|s| s.trim().to_string());
            continue;
        }
        if field_name == "scope" {
            idea_scope = field.text().await.ok().map(|s| s.trim().to_string());
            continue;
        }
        if field_name == "file" && bytes.is_none() {
            file_name = field.file_name().map(str::to_string);
            mime = field.content_type().map(str::to_string);
            bytes = match field.bytes().await {
                Ok(b) => Some(b.to_vec()),
                Err(e) => {
                    return (
                        StatusCode::BAD_REQUEST,
                        Json(serde_json::json!({"ok": false, "error": format!("failed to read file: {e}")})),
                    )
                    .into_response();
                }
            };
        }
    }

    let Some(agent_id) = agent_id.filter(|s| !s.is_empty()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"ok": false, "error": "agent_id required"})),
        )
            .into_response();
    };
    let Some(bytes) = bytes else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"ok": false, "error": "file field required"})),
        )
            .into_response();
    };

    let mut params = serde_json::json!({
        "agent_id": agent_id,
        "name": file_name.unwrap_or_else(|| "file".to_string()),
        "mime": mime.unwrap_or_else(|| "application/octet-stream".to_string()),
        "content_b64": base64::engine::general_purpose::STANDARD.encode(&bytes),
    });
    if let Some(parent_id) = parent_idea_id {
        params["parent_idea_id"] = serde_json::Value::String(parent_id);
    }
    if let Some(scope) = idea_scope.filter(|s| !s.is_empty()) {
        params["scope"] = serde_json::Value::String(scope);
    }

    ipc_proxy(state, scope.as_ref(), "files_upload", params).await
}

async fn update_idea(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "update_idea",
        merge_path_id(body, "id", id),
    )
    .await
}

async fn delete_idea(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "delete_idea",
        serde_json::json!({"id": id}),
    )
    .await
}

#[derive(Deserialize, Serialize, Default)]
struct SearchIdeasQuery {
    query: Option<String>,
    agent_id: Option<String>,
    tags: Option<String>,
    top_k: Option<u64>,
}

async fn search_ideas(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<SearchIdeasQuery>,
) -> Response {
    let mut params = query_to_params(&q);
    // Parse comma-separated tags into an array.
    if let Some(tags_str) = &q.tags {
        let parsed: Vec<&str> = tags_str
            .split(',')
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .collect();
        if !parsed.is_empty() {
            params["tags"] = serde_json::json!(parsed);
        }
    }
    ipc_proxy(state, scope.as_ref(), "search_ideas", params).await
}

#[derive(Deserialize, Serialize, Default)]
struct PrefixQuery {
    prefix: Option<String>,
    limit: Option<u64>,
}

async fn ideas_by_prefix(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<PrefixQuery>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "idea_prefix", query_to_params(&q)).await
}

async fn ideas_by_ids(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "ideas_by_ids", body).await
}

#[derive(Deserialize, Serialize, Default)]
struct ProjectQuery {
    project: Option<String>,
}

async fn idea_profile(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<ProjectQuery>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "idea_profile", query_to_params(&q)).await
}

#[derive(Deserialize, Serialize, Default)]
struct IdeaGraphQuery {
    agent_id: Option<String>,
    limit: Option<u64>,
}

async fn idea_graph(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<IdeaGraphQuery>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "idea_graph", query_to_params(&q)).await
}

async fn get_idea_edges(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "idea_edges",
        serde_json::json!({"idea_id": id}),
    )
    .await
}

async fn add_idea_edge(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "add_idea_edge",
        merge_path_id(body, "source_id", id),
    )
    .await
}

async fn remove_idea_edge(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "remove_idea_edge",
        merge_path_id(body, "source_id", id),
    )
    .await
}

async fn seed_ideas(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "seed_ideas", body).await
}

/// `GET /api/ideas/:id/children` — Tables-in-Ideas Phase 2.
async fn list_idea_children(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "list_idea_children",
        serde_json::json!({"parent_id": id}),
    )
    .await
}

/// `PUT /api/ideas/:id/properties` — deep-merge a JSON patch into the
/// Idea's `properties` column. Tables-in-Ideas Phase 2.
async fn set_idea_properties(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let payload = match body {
        serde_json::Value::Object(_) => serde_json::json!({"id": id, "properties": body}),
        other => serde_json::json!({"id": id, "properties": other}),
    };
    ipc_proxy(state, scope.as_ref(), "set_idea_properties", payload).await
}

/// `GET /api/ideas/:id/activity`
///
/// Returns the merged chronological activity feed for an idea — activity-log
/// entries and system messages from the idea's backing session, sorted oldest
/// first. Returns `{ ok: true, items: [] }` when the idea has no session yet.
async fn idea_activity(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "idea_activity",
        serde_json::json!({"idea_id": id}),
    )
    .await
}

/// `GET /api/ideas/:id/comments`
///
/// Returns conversation messages (non-system) from the idea's backing
/// session, oldest first. Returns `{ ok: true, items: [] }` when the idea
/// has no session yet.
async fn idea_comments(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "idea_comments",
        serde_json::json!({"idea_id": id}),
    )
    .await
}

/// `POST /api/ideas/:id/subscribe`
///
/// Lazy-creates the idea's backing session if needed, then adds the calling
/// user (resolved from JWT scope) as a `session_participants` row. Returns
/// `{ ok, session_id, subscribed }`. Used by the conversation panel's
/// Subscribe button so a fresh idea with no comments yet is still subscribable.
async fn idea_subscribe(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "subscribe_to_idea",
        serde_json::json!({"idea_id": id}),
    )
    .await
}
