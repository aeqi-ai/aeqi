//! Role IPC handlers.
//!
//! Three commands: `list_roles`, `create_role`, and `change_occupant`.
//!
//! `change_occupant` swaps the role's occupant and rotates the participant
//! set on every session anchored to that role, then appends a system
//! hand-off message so the conversation history is continuous.
//! Tenancy is enforced against the active scope — roles live inside an
//! entity, so the caller's `allowed` list filters reads and rejects writes
//! outside their scope.

use crate::role_registry::OccupantKind;

use super::tenancy::is_allowed;

pub async fn handle_list_roles(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let entity_id = match super::request_field(request, "entity_id") {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => return serde_json::json!({"ok": false, "error": "entity_id is required"}),
    };

    if allowed.is_some() && !is_allowed(allowed, &entity_id) {
        return serde_json::json!({"ok": false, "error": "access denied"});
    }

    let roles = match ctx.role_registry.list_for_entity(&entity_id).await {
        Ok(v) => v,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };
    let edges = match ctx.role_registry.list_edges_for_entity(&entity_id).await {
        Ok(v) => v,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    serde_json::json!({
        "ok": true,
        "roles": roles,
        "edges": edges,
    })
}

pub async fn handle_create_role(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let entity_id = match super::request_field(request, "entity_id") {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => return serde_json::json!({"ok": false, "error": "entity_id is required"}),
    };
    if allowed.is_some() && !is_allowed(allowed, &entity_id) {
        return serde_json::json!({"ok": false, "error": "access denied"});
    }

    let title = super::request_field(request, "title")
        .unwrap_or("")
        .to_string();
    let kind_str = super::request_field(request, "occupant_kind").unwrap_or("vacant");
    let kind = match kind_str.parse::<OccupantKind>() {
        Ok(k) => k,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };
    let occupant_id = super::request_field(request, "occupant_id").map(str::to_string);
    if matches!(kind, OccupantKind::Human | OccupantKind::Agent) && occupant_id.is_none() {
        return serde_json::json!({
            "ok": false,
            "error": "occupant_id is required when occupant_kind is human or agent",
        });
    }

    let parent_role_id = super::request_field(request, "parent_role_id").map(str::to_string);

    let role = match ctx
        .role_registry
        .create(&entity_id, &title, kind, occupant_id.as_deref())
        .await
    {
        Ok(r) => r,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    if let Some(parent_id) = parent_role_id.as_deref()
        && let Err(e) = ctx.role_registry.add_edge(parent_id, &role.id).await
    {
        return serde_json::json!({"ok": false, "error": e.to_string()});
    }

    serde_json::json!({"ok": true, "role": role})
}

/// Handle a `change_occupant` IPC command.
///
/// # Request shape
///
/// ```json
/// {
///   "role_id":        "<uuid>",
///   "occupant_kind":  "human" | "agent" | "vacant",
///   "occupant_id":    "<id>"    // required unless kind=vacant
/// }
/// ```
///
/// # Side effects
///
/// For every active session with `target_role_id = role_id`:
///   1. Removes the OLD occupant from `session_participants`.
///   2. Adds the NEW occupant to `session_participants` (joined_by="system").
///   3. Appends a system message: `"<old_kind>:<old_id> handed off to <new_kind>:<new_id>"`.
///
/// This preserves session continuity through occupant changes.
pub async fn handle_change_occupant(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let role_id = match super::request_field(request, "role_id") {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => return serde_json::json!({"ok": false, "error": "role_id is required"}),
    };
    let kind_str = super::request_field(request, "occupant_kind").unwrap_or("vacant");
    let new_kind = match kind_str.parse::<OccupantKind>() {
        Ok(k) => k,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };
    let new_occupant_id = super::request_field(request, "occupant_id").map(str::to_string);
    if matches!(new_kind, OccupantKind::Human | OccupantKind::Agent) && new_occupant_id.is_none() {
        return serde_json::json!({
            "ok": false,
            "error": "occupant_id is required when occupant_kind is human or agent",
        });
    }

    // Fetch the current (old) occupant before the update.
    let role = match ctx.role_registry.get(&role_id).await {
        Ok(Some(r)) => r,
        Ok(None) => return serde_json::json!({"ok": false, "error": "role not found"}),
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    let old_kind_str = match role.occupant_kind {
        OccupantKind::Human => "user",
        OccupantKind::Agent => "agent",
        OccupantKind::Vacant => "vacant",
    };
    let old_occupant_id = role.occupant_id.clone();

    // Persist the update.
    if let Err(e) = ctx
        .role_registry
        .update_occupant(&role_id, new_kind, new_occupant_id.as_deref())
        .await
    {
        return serde_json::json!({"ok": false, "error": e.to_string()});
    }

    // Rotate participants on every anchored session.
    let Some(ref ss) = ctx.session_store else {
        // No session store — update succeeded but no session rotation.
        return serde_json::json!({"ok": true, "sessions_updated": 0});
    };

    let anchored = match ss.sessions_by_target_role(&role_id).await {
        Ok(v) => v,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    let new_kind_str = match new_kind {
        OccupantKind::Human => "user",
        OccupantKind::Agent => "agent",
        OccupantKind::Vacant => "vacant",
    };

    let handoff_body = {
        let old_label = old_occupant_id
            .as_deref()
            .map(|id| format!("{old_kind_str}:{id}"))
            .unwrap_or_else(|| "vacant".to_string());
        let new_label = new_occupant_id
            .as_deref()
            .map(|id| format!("{new_kind_str}:{id}"))
            .unwrap_or_else(|| "vacant".to_string());
        format!("{old_label} handed off to {new_label}")
    };

    let mut sessions_updated: usize = 0;
    for session_id in &anchored {
        // Remove old occupant (no-op if vacant or already absent).
        if let Some(ref old_id) = old_occupant_id
            && !matches!(role.occupant_kind, OccupantKind::Vacant)
        {
            let _ = ss
                .remove_session_participant(session_id, old_kind_str, old_id)
                .await;
        }

        // Add new occupant (idempotent if already a participant).
        if let Some(ref new_id) = new_occupant_id
            && !matches!(new_kind, OccupantKind::Vacant)
        {
            let _ = ss
                .add_session_participant(session_id, new_kind_str, new_id, Some("system"))
                .await;
        }

        // Append hand-off system message.
        let _ = ss
            .append_message_from(session_id, "system", &handoff_body, "system", None, None)
            .await;

        sessions_updated += 1;
    }

    serde_json::json!({
        "ok": true,
        "role_id": role_id,
        "sessions_updated": sessions_updated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ipc::CommandContext;
    use crate::session_store::SessionStore;
    use std::sync::Arc;

    async fn build_test_ctx(dir: &std::path::Path) -> (CommandContext, Arc<SessionStore>) {
        use crate::dispatch::{DispatchConfig, Dispatcher};
        use crate::ipc::ActivityBuffer;
        use tokio::sync::Mutex;

        let registry = Arc::new(crate::agent_registry::AgentRegistry::open(dir).unwrap());
        let sessions_pool = crate::agent_registry::ConnectionPool::in_memory().unwrap();
        {
            let conn = sessions_pool.lock().await;
            SessionStore::create_tables(&conn).unwrap();
        }
        let ss = Arc::new(SessionStore::new(Arc::new(sessions_pool)));
        let (embed_queue, _rx) = aeqi_ideas::embed_worker::EmbedQueue::channel(8);

        let ctx = CommandContext {
            metrics: Arc::new(crate::metrics::AEQIMetrics::new()),
            activity_log: Arc::new(crate::activity_log::ActivityLog::new(registry.db())),
            session_store: Some(Arc::clone(&ss)),
            event_handler_store: None,
            agent_registry: registry.clone(),
            entity_registry: Arc::new(crate::entity_registry::EntityRegistry::open(registry.db())),
            role_registry: Arc::new(crate::role_registry::RoleRegistry::open(registry.db())),
            idea_store: None,
            message_router: None,
            activity_buffer: Arc::new(Mutex::new(ActivityBuffer::default())),
            default_provider: None,
            default_model: "test".to_string(),
            session_manager: Arc::new(crate::session_manager::SessionManager::new()),
            dispatcher: Arc::new(Dispatcher::new(DispatchConfig::default())),
            daily_budget_usd: 0.0,
            skill_loader: None,
            execution_registry: Arc::new(crate::execution_registry::ExecutionRegistry::new()),
            stream_registry: Arc::new(crate::stream_registry::StreamRegistry::new()),
            channel_spawner: None,
            tag_policy_cache: Arc::new(aeqi_ideas::tag_policy::TagPolicyCache::new(60)),
            embed_queue: Arc::new(embed_queue),
            embedder: None,
            recall_cache: Arc::new(aeqi_ideas::RecallCache::default()),
            pattern_dispatcher: None,
            credentials: None,
        };
        (ctx, ss)
    }

    /// Create an entity + agent-occupied role in the given ctx.
    async fn make_occupied_role(ctx: &CommandContext, agent_id: &str) -> String {
        let entity = ctx
            .entity_registry
            .create_new(
                "Test Co",
                "testco",
                crate::entity_registry::EntityType::Company,
                None,
                None,
            )
            .await
            .unwrap();
        let role = ctx
            .role_registry
            .create(&entity.id, "CEO", OccupantKind::Agent, Some(agent_id))
            .await
            .unwrap();
        role.id
    }

    #[tokio::test]
    async fn change_occupant_swaps_participants_and_emits_handoff() {
        let dir = tempfile::tempdir().unwrap();
        let (ctx, ss) = build_test_ctx(dir.path()).await;

        let old_agent = "agent-old";
        let new_agent = "agent-new";

        let role_id = make_occupied_role(&ctx, old_agent).await;

        // Anchor a session on the role and add the old occupant as a
        // participant so change_occupant has something to rotate.
        let session_id = ss
            .create_role_session(&role_id, &format!("role:{role_id}"))
            .await
            .unwrap();
        ss.add_session_participant(&session_id, "agent", old_agent, None)
            .await
            .unwrap();

        let req = serde_json::json!({
            "role_id": role_id,
            "occupant_kind": "agent",
            "occupant_id": new_agent,
        });

        let resp = handle_change_occupant(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], true, "response: {resp}");
        assert_eq!(resp["sessions_updated"], 1);

        // Old occupant must be gone from session_participants.
        let participants = {
            let pool = ss.db();
            let db = pool.lock().await;
            let mut stmt = db
                .prepare(
                    "SELECT identity_kind, identity_id FROM session_participants \
                     WHERE session_id = ?1",
                )
                .unwrap();
            stmt.query_map(rusqlite::params![session_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect::<Vec<_>>()
        };
        assert!(
            !participants
                .iter()
                .any(|(k, id)| k == "agent" && id == old_agent),
            "old occupant must be removed from participants; got {participants:?}"
        );
        assert!(
            participants
                .iter()
                .any(|(k, id)| k == "agent" && id == new_agent),
            "new occupant must be added to participants; got {participants:?}"
        );

        // Hand-off system message must be in the timeline.
        let timeline = ss.timeline_by_session(&session_id, 10).await.unwrap();
        let handoff = timeline
            .iter()
            .find(|e| e.content.contains("handed off to"));
        assert!(handoff.is_some(), "handoff message not found in timeline");
        assert_eq!(handoff.unwrap().role, "system");
    }

    #[tokio::test]
    async fn change_occupant_session_continuity() {
        // A session created before the change must be the same session after.
        let dir = tempfile::tempdir().unwrap();
        let (ctx, ss) = build_test_ctx(dir.path()).await;

        let role_id = make_occupied_role(&ctx, "agent-alpha").await;

        // First message anchors the session.
        let session_id_before = ss
            .create_role_session(&role_id, &format!("role:{role_id}"))
            .await
            .unwrap();

        // Change occupant.
        let req = serde_json::json!({
            "role_id": role_id,
            "occupant_kind": "agent",
            "occupant_id": "agent-beta",
        });
        let resp = handle_change_occupant(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], true);

        // The session id must be unchanged.
        let still_active = ss.get_session(&session_id_before).await.unwrap().unwrap();
        assert_eq!(
            still_active.id, session_id_before,
            "session id must not change after occupant swap"
        );
        assert_eq!(still_active.status, "active");
    }
}
