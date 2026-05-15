use crate::agent_registry::AgentRegistry;

const ASSIGNEE_HELP: &str = "Invalid assignee. Use 'user:<uuid>' or 'agent:<uuid>'.";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QuestCallerPrincipal {
    User(String),
    Agent(String),
}

impl QuestCallerPrincipal {
    pub fn assignee(&self) -> String {
        match self {
            Self::User(id) => format!("user:{id}"),
            Self::Agent(id) => format!("agent:{id}"),
        }
    }
}

pub fn caller_principal_from_request(request: &serde_json::Value) -> Option<QuestCallerPrincipal> {
    request
        .get("caller_user_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(|s| QuestCallerPrincipal::User(s.trim().to_string()))
        .or_else(|| {
            request
                .get("caller_agent_id")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .map(|s| QuestCallerPrincipal::Agent(s.trim().to_string()))
        })
}

pub fn auto_assignee_for_in_progress(
    status: Option<aeqi_quests::QuestStatus>,
    assignee_update: Option<Option<String>>,
    caller: Option<QuestCallerPrincipal>,
) -> Result<Option<Option<String>>, String> {
    if assignee_update.is_none() && matches!(status, Some(aeqi_quests::QuestStatus::InProgress)) {
        let principal = caller.ok_or_else(|| {
            "status=in_progress requires an assignee or authenticated caller principal".to_string()
        })?;
        return Ok(Some(Some(principal.assignee())));
    }

    Ok(assignee_update)
}

pub async fn validate_assignee_update(
    registry: &AgentRegistry,
    assignee_update: Option<Option<String>>,
) -> Result<Option<Option<String>>, String> {
    match assignee_update {
        Some(Some(assignee)) => validate_assignee(registry, &assignee)
            .await
            .map(|validated| Some(Some(validated))),
        other => Ok(other),
    }
}

async fn validate_assignee(registry: &AgentRegistry, assignee: &str) -> Result<String, String> {
    let (kind, id) = assignee
        .trim()
        .split_once(':')
        .ok_or_else(|| ASSIGNEE_HELP.to_string())?;
    if kind != "user" && kind != "agent" {
        return Err(ASSIGNEE_HELP.to_string());
    }

    let id = uuid::Uuid::parse_str(id)
        .map_err(|_| ASSIGNEE_HELP.to_string())?
        .to_string();

    if kind == "agent"
        && registry
            .get(&id)
            .await
            .map_err(|e| e.to_string())?
            .is_none()
    {
        return Err(format!("Unknown assignee agent: {id}"));
    }

    Ok(format!("{kind}:{id}"))
}
