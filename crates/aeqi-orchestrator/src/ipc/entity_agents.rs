//! IPC handlers for an entity's default agent — the one that occupies the
//! topmost role in the entity's role DAG. There is no "agent tree" anymore:
//! agents are owned by an entity and arranged by the role tree.

use super::tenancy::is_allowed;

pub async fn handle_create_default_agent(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let name = request.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let is_safe_name = !name.is_empty()
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains('\0')
        && name != "."
        && name != ".."
        && !name.starts_with('.')
        && name.len() <= 128;
    if !is_safe_name {
        return serde_json::json!({"ok": false, "error": "invalid name"});
    }

    let prefix = request
        .get("prefix")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| name.chars().take(2).collect::<String>().to_lowercase());

    // Spawn a fresh entity with its default agent (no parent → fresh
    // entity + agent + role).
    let agent = ctx.agent_registry.spawn(name, None, None).await;
    match agent {
        Ok(a) => {
            if let Ok(cwd) = std::env::current_dir() {
                let project_dir = cwd.join("projects").join(name);
                let _ = std::fs::create_dir_all(&project_dir);
            }
            serde_json::json!({"ok": true, "id": a.id, "agent": {"name": name, "prefix": prefix}})
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_update_default_agent(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let name = request.get("name").and_then(|v| v.as_str()).unwrap_or("");
    if name.is_empty() {
        serde_json::json!({"ok": false, "error": "name is required"})
    } else if allowed.is_some() && !is_allowed(allowed, name) {
        serde_json::json!({"ok": false, "error": "access denied"})
    } else {
        let new_name = request
            .get("new_name")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty());
        // Find the default agent by name or ID and update it.
        match ctx.agent_registry.list_entity_agents().await {
            Ok(agents) => {
                if let Some(agent) = agents.iter().find(|a| a.name == name || a.id == name) {
                    let Some(new_name) = new_name else {
                        return serde_json::json!({"ok": false, "error": "new_name is required"});
                    };
                    match ctx.agent_registry.update_name(&agent.id, new_name).await {
                        Ok(()) => serde_json::json!({"ok": true}),
                        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
                    }
                } else {
                    serde_json::json!({"ok": false, "error": "default agent not found"})
                }
            }
            Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
        }
    }
}
