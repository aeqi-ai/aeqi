//! Role Registry — the canonical org-chart primitive.
//!
//! A role is a slot in an entity's org chart. Its occupant is a human
//! (`users.id`), an agent (`agents.id`), or vacant. Authority is resolved by
//! transitive closure over `role_edges` (DAG, not tree — boards of
//! directors are flat sets at the top).
//!
//! The registry shares its connection pool with [`AgentRegistry`] and
//! [`EntityRegistry`] so all three operate on the same `aeqi.db`.

use crate::agent_registry::ConnectionPool;
use anyhow::{Result, bail};
use chrono::Utc;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Who occupies a role. `Vacant` is a first-class state — useful for
/// "we're hiring CFO" placeholders that already carry edges in the DAG.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OccupantKind {
    Human,
    Agent,
    Vacant,
}

impl OccupantKind {
    fn as_db(self) -> &'static str {
        match self {
            OccupantKind::Human => "human",
            OccupantKind::Agent => "agent",
            OccupantKind::Vacant => "vacant",
        }
    }
}

impl std::str::FromStr for OccupantKind {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self> {
        match s {
            "human" => Ok(OccupantKind::Human),
            "agent" => Ok(OccupantKind::Agent),
            "vacant" => Ok(OccupantKind::Vacant),
            other => bail!("unknown occupant kind: {}", other),
        }
    }
}

/// A single role row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Role {
    pub id: String,
    pub entity_id: String,
    pub title: String,
    pub occupant_kind: OccupantKind,
    pub occupant_id: Option<String>,
    pub created_at: String,
    pub updated_at: Option<String>,
}

/// A directed edge in the role DAG: `parent` controls `child`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleEdge {
    pub parent_role_id: String,
    pub child_role_id: String,
}

fn row_to_role(row: &rusqlite::Row<'_>) -> rusqlite::Result<Role> {
    Ok(Role {
        id: row.get(0)?,
        entity_id: row.get(1)?,
        title: row.get(2)?,
        occupant_kind: {
            let s: String = row.get(3)?;
            s.parse::<OccupantKind>().unwrap_or(OccupantKind::Vacant)
        },
        occupant_id: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn row_to_edge(row: &rusqlite::Row<'_>) -> rusqlite::Result<RoleEdge> {
    Ok(RoleEdge {
        parent_role_id: row.get(0)?,
        child_role_id: row.get(1)?,
    })
}

/// SQLite-backed role registry. Shares `ConnectionPool` with
/// [`AgentRegistry`] and [`EntityRegistry`].
pub struct RoleRegistry {
    db: Arc<ConnectionPool>,
}

impl RoleRegistry {
    pub fn open(db: Arc<ConnectionPool>) -> Self {
        Self { db }
    }

    /// All roles in the entity, ordered by creation time.
    pub async fn list_for_entity(&self, entity_id: &str) -> Result<Vec<Role>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT id, entity_id, title, occupant_kind, occupant_id, created_at, updated_at
             FROM roles
             WHERE entity_id = ?1
             ORDER BY created_at ASC",
        )?;
        let rows = stmt
            .query_map(params![entity_id], row_to_role)?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    }

    /// All edges between roles in this entity (filtered by parent's
    /// entity_id; edges only ever connect roles inside the same entity).
    pub async fn list_edges_for_entity(&self, entity_id: &str) -> Result<Vec<RoleEdge>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT e.parent_role_id, e.child_role_id
             FROM role_edges e
             JOIN roles r ON r.id = e.parent_role_id
             WHERE r.entity_id = ?1",
        )?;
        let rows = stmt
            .query_map(params![entity_id], row_to_edge)?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    }

    /// Insert a role with a known id (idempotent — ON CONFLICT DO NOTHING).
    /// Used by spawn paths that mint the role alongside the agent.
    pub async fn upsert(
        &self,
        id: &str,
        entity_id: &str,
        title: &str,
        kind: OccupantKind,
        occupant_id: Option<&str>,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        let db = self.db.lock().await;
        db.execute(
            "INSERT INTO roles (id, entity_id, title, occupant_kind, occupant_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO NOTHING",
            params![id, entity_id, title, kind.as_db(), occupant_id, now],
        )?;
        Ok(())
    }

    /// Mint a fresh role with a new UUID. Returns the created row.
    pub async fn create(
        &self,
        entity_id: &str,
        title: &str,
        kind: OccupantKind,
        occupant_id: Option<&str>,
    ) -> Result<Role> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let db = self.db.lock().await;
        db.execute(
            "INSERT INTO roles (id, entity_id, title, occupant_kind, occupant_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, entity_id, title, kind.as_db(), occupant_id, now],
        )?;
        let role = db
            .query_row(
                "SELECT id, entity_id, title, occupant_kind, occupant_id, created_at, updated_at
                 FROM roles WHERE id = ?1",
                params![id],
                row_to_role,
            )
            .optional()?
            .ok_or_else(|| anyhow::anyhow!("role not found after insert"))?;
        Ok(role)
    }

    /// Add an edge to the DAG. Idempotent.
    pub async fn add_edge(&self, parent_id: &str, child_id: &str) -> Result<()> {
        if parent_id == child_id {
            bail!("self-loop edges are forbidden");
        }
        let db = self.db.lock().await;
        db.execute(
            "INSERT INTO role_edges (parent_role_id, child_role_id)
             VALUES (?1, ?2)
             ON CONFLICT(parent_role_id, child_role_id) DO NOTHING",
            params![parent_id, child_id],
        )?;
        Ok(())
    }

    /// Fetch a single role by id. Returns `None` when not found.
    pub async fn get(&self, role_id: &str) -> Result<Option<Role>> {
        let db = self.db.lock().await;
        let result = db
            .query_row(
                "SELECT id, entity_id, title, occupant_kind, occupant_id, created_at, updated_at
                 FROM roles WHERE id = ?1",
                params![role_id],
                row_to_role,
            )
            .optional()?;
        Ok(result)
    }

    /// Update the occupant of a role in-place.
    ///
    /// Called by `handle_change_occupant` after verifying the role exists.
    /// Stamps `updated_at`.
    pub async fn update_occupant(
        &self,
        role_id: &str,
        new_kind: OccupantKind,
        new_occupant_id: Option<&str>,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        let db = self.db.lock().await;
        db.execute(
            "UPDATE roles \
             SET occupant_kind = ?1, occupant_id = ?2, updated_at = ?3 \
             WHERE id = ?4",
            params![new_kind.as_db(), new_occupant_id, now, role_id],
        )?;
        Ok(())
    }

    /// Wipe every role and edge for an entity. Used by
    /// `spawn_blueprint` when the template declares explicit `seed_roles`:
    /// the agent_registry's spawn-time auto-roles get cleared so the
    /// declared structure can be installed fresh, in a single transaction
    /// with the redeclaration. Edges go first (FK to roles).
    pub async fn delete_for_entity(&self, entity_id: &str) -> Result<()> {
        let db = self.db.lock().await;
        db.execute(
            "DELETE FROM role_edges
             WHERE parent_role_id IN (SELECT id FROM roles WHERE entity_id = ?1)
                OR child_role_id IN (SELECT id FROM roles WHERE entity_id = ?1)",
            params![entity_id],
        )?;
        db.execute("DELETE FROM roles WHERE entity_id = ?1", params![entity_id])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_registry::AgentRegistry;
    use std::sync::Arc;
    use tempfile::TempDir;

    fn open_test_registries() -> (
        TempDir,
        Arc<AgentRegistry>,
        crate::entity_registry::EntityRegistry,
        RoleRegistry,
    ) {
        let dir = TempDir::new().expect("tempdir");
        let agents = Arc::new(AgentRegistry::open(dir.path()).expect("agent registry"));
        let entities = crate::entity_registry::EntityRegistry::open(agents.db());
        let roles = RoleRegistry::open(agents.db());
        (dir, agents, entities, roles)
    }

    #[tokio::test]
    async fn create_role_and_list() {
        let (_dir, _agents, entities, roles) = open_test_registries();

        let entity = entities
            .create_new(
                "Acme Co",
                "acme",
                crate::entity_registry::EntityType::Company,
                None,
                None,
            )
            .await
            .expect("create entity");

        let role = roles
            .create(&entity.id, "CEO", OccupantKind::Vacant, None)
            .await
            .expect("create role");

        let listed = roles.list_for_entity(&entity.id).await.expect("list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, role.id);
        assert_eq!(listed[0].occupant_kind, OccupantKind::Vacant);
    }

    #[tokio::test]
    async fn add_edge_idempotent() {
        let (_dir, _agents, entities, roles) = open_test_registries();

        let entity = entities
            .create_new(
                "Acme",
                "acme",
                crate::entity_registry::EntityType::Company,
                None,
                None,
            )
            .await
            .expect("entity");
        let r1 = roles
            .create(&entity.id, "Board", OccupantKind::Vacant, None)
            .await
            .expect("r1");
        let r2 = roles
            .create(&entity.id, "CEO", OccupantKind::Vacant, None)
            .await
            .expect("r2");

        roles.add_edge(&r1.id, &r2.id).await.expect("edge 1");
        roles
            .add_edge(&r1.id, &r2.id)
            .await
            .expect("edge 2 (idempotent)");

        let edges = roles
            .list_edges_for_entity(&entity.id)
            .await
            .expect("edges");
        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].parent_role_id, r1.id);
        assert_eq!(edges[0].child_role_id, r2.id);
    }

    #[tokio::test]
    async fn self_loop_rejected() {
        let (_dir, _agents, entities, roles) = open_test_registries();

        let entity = entities
            .create_new(
                "Acme",
                "acme",
                crate::entity_registry::EntityType::Company,
                None,
                None,
            )
            .await
            .expect("entity");
        let r = roles
            .create(&entity.id, "CEO", OccupantKind::Vacant, None)
            .await
            .expect("r");

        let err = roles.add_edge(&r.id, &r.id).await;
        assert!(err.is_err(), "self-loop must be rejected");
    }
}
