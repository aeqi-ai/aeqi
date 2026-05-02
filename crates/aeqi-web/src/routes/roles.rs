use axum::{
    Json, Router,
    extract::{Path, Query, State},
    response::Response,
    routing::{get, post},
};

use super::helpers::ipc_proxy;
use crate::extractors::Scope;
use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/roles", get(list_roles).post(create_role))
        .route("/roles/{id}/occupant", post(change_occupant))
}

#[derive(serde::Deserialize)]
struct ListQuery {
    entity_id: Option<String>,
}

async fn list_roles(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<ListQuery>,
) -> Response {
    let entity_id = q.entity_id.unwrap_or_default();
    ipc_proxy(
        state,
        scope.as_ref(),
        "list_roles",
        serde_json::json!({"entity_id": entity_id}),
    )
    .await
}

async fn create_role(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "create_role", body).await
}

/// POST /api/roles/:id/occupant
///
/// Body: `{ "occupant_kind": "human"|"agent"|"vacant", "occupant_id": "<id>" }`
///
/// Proxies to the `change_occupant` IPC command, which:
///   - Updates the role row.
///   - Rotates participant sets on every anchored session.
///   - Appends a system hand-off message in each session.
///
/// Tenancy: the `allowed_roots` scope injected by `ipc_proxy` gates writes
/// to roles the caller owns.
async fn change_occupant(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(mut body): Json<serde_json::Value>,
) -> Response {
    body["role_id"] = serde_json::Value::String(id);
    ipc_proxy(state, scope.as_ref(), "change_occupant", body).await
}
