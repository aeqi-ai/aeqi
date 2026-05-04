import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import {
  fetchRolesForModule,
  fetchTrustModules,
  findModuleByType,
  indexerEnabled,
  type IndexedRole,
} from "@/lib/indexer";
import type { Role, RoleType } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";

interface OwnershipPageProps {
  entityId: string;
}

const ROLE_TYPE_ORDER: RoleType[] = ["director", "operational", "advisor"];

const ROLE_TYPE_LABEL: Record<RoleType, string> = {
  director: "Directors",
  operational: "Operational",
  advisor: "Advisors",
};

/**
 * Phase 1 ownership view: who owns and runs this Company, surfaced from
 * the off-chain Role primitive. Founders render first, then directors,
 * operational roles, advisors. The on-chain TRUST mirror — present once
 * the Solana bridge has indexed the entity — appears as a supplementary
 * section under the role pivot.
 */
export default function OwnershipPage({ entityId }: OwnershipPageProps) {
  const entity = useDaemonStore((s) => s.entities.find((e) => e.id === entityId));
  const agents = useDaemonStore((s) => s.agents);
  const navigate = useNavigate();
  const trustAddress = entity?.trust_address;

  const [roles, setRoles] = useState<Role[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRoles(null);
    setError(null);
    (async () => {
      try {
        const { roles } = await api.getRoles(entityId);
        if (!cancelled) setRoles(roles);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entityId]);

  const grouped = useMemo(() => {
    if (!roles) return null;
    const founders = roles.filter((r) => r.founder);
    const byType: Record<RoleType, Role[]> = { director: [], operational: [], advisor: [] };
    for (const r of roles) {
      if (r.founder) continue;
      byType[r.role_type].push(r);
    }
    return { founders, byType };
  }, [roles]);

  const occupantLabel = (role: Role): string => {
    if (role.occupant_kind === "vacant" || !role.occupant_id) return "Vacant — hiring";
    if (role.occupant_kind === "agent") {
      const agent = agents.find((a) => a.id === role.occupant_id);
      return agent ? agent.name : "Agent";
    }
    return "Human";
  };

  if (error) {
    return (
      <div className="asv-main" style={{ padding: "var(--space-lg)" }}>
        <EmptyState title="Ownership" description={`Couldn't load roles: ${error}`} />
      </div>
    );
  }

  if (!roles || !grouped) {
    return (
      <div
        className="asv-main"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--space-xl)",
        }}
      >
        <Spinner />
      </div>
    );
  }

  if (roles.length === 0) {
    return (
      <div className="asv-main" style={{ padding: "var(--space-lg)" }}>
        <EmptyState
          title="Ownership"
          description="No roles defined yet. Add a role from the Roles tab to start the org chart."
        />
      </div>
    );
  }

  return (
    <div className="asv-main" style={{ padding: "var(--space-lg)" }}>
      <header style={{ marginBottom: "var(--space-lg)" }}>
        <h2 style={{ margin: 0 }}>Ownership</h2>
        <p style={{ color: "var(--color-text-muted)", margin: "var(--space-xs) 0 0 0" }}>
          Who owns and runs this Company. Authority flows through roles.
        </p>
      </header>

      {grouped.founders.length > 0 && (
        <RoleSection
          title="Founders"
          roles={grouped.founders}
          occupantLabel={occupantLabel}
          onOpenRole={(roleId) => navigate(`/c/${entityId}/roles/${roleId}`)}
        />
      )}

      {ROLE_TYPE_ORDER.map((t) =>
        grouped.byType[t].length > 0 ? (
          <RoleSection
            key={t}
            title={ROLE_TYPE_LABEL[t]}
            roles={grouped.byType[t]}
            occupantLabel={occupantLabel}
            onOpenRole={(roleId) => navigate(`/c/${entityId}/roles/${roleId}`)}
          />
        ) : null,
      )}

      {indexerEnabled() && trustAddress && <OnChainCapTable trustAddress={trustAddress} />}
    </div>
  );
}

interface RoleSectionProps {
  title: string;
  roles: Role[];
  occupantLabel: (role: Role) => string;
  onOpenRole: (roleId: string) => void;
}

function RoleSection({ title, roles, occupantLabel, onOpenRole }: RoleSectionProps) {
  return (
    <section style={{ marginBottom: "var(--space-lg)" }}>
      <h3
        style={{
          margin: "0 0 var(--space-sm) 0",
          fontSize: "var(--text-sm)",
          color: "var(--color-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {title}
        <span style={{ marginLeft: "var(--space-xs)" }}>· {roles.length}</span>
      </h3>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {roles.map((r) => (
          <li
            key={r.id}
            onClick={() => onOpenRole(r.id)}
            style={{
              padding: "var(--space-sm) var(--space-md)",
              background: "var(--color-card)",
              borderRadius: "var(--radius-md)",
              marginBottom: "var(--space-xs)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "var(--space-md)",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500 }}>{r.title}</div>
              <div
                style={{
                  fontSize: "var(--text-sm)",
                  color: "var(--color-text-muted)",
                  marginTop: 2,
                }}
              >
                {occupantLabel(r)}
              </div>
            </div>
            <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
              {r.founder && (
                <Badge variant="accent" size="sm">
                  Founder
                </Badge>
              )}
              <Badge variant="muted" size="sm">
                {r.grants.length} {r.grants.length === 1 ? "grant" : "grants"}
              </Badge>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function OnChainCapTable({ trustAddress }: { trustAddress: string }) {
  const [chainRoles, setChainRoles] = useState<IndexedRole[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mods = await fetchTrustModules(trustAddress);
        const roleModule = findModuleByType(mods, "role");
        if (!roleModule) {
          if (!cancelled) setChainRoles([]);
          return;
        }
        const r = await fetchRolesForModule(roleModule.moduleAddress);
        if (!cancelled) setChainRoles(r);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trustAddress]);

  if (error || !chainRoles || chainRoles.length === 0) return null;

  return (
    <section style={{ marginTop: "var(--space-xl)" }}>
      <h3
        style={{
          margin: "0 0 var(--space-sm) 0",
          fontSize: "var(--text-sm)",
          color: "var(--color-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        On-chain mirror · {chainRoles.length}
      </h3>
      <p
        style={{
          color: "var(--color-text-muted)",
          fontSize: "var(--text-sm)",
          margin: "0 0 var(--space-sm) 0",
        }}
      >
        TRUST <code style={{ fontFamily: "var(--font-mono)" }}>{trustAddress.slice(0, 14)}…</code> —
        roles indexed from the on-chain Role module.
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {chainRoles.map((r) => (
          <li
            key={r.roleId}
            style={{
              padding: "var(--space-xs) var(--space-md)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-sm)",
              color: "var(--color-text-muted)",
            }}
          >
            {r.roleId.slice(0, 12)}… · created block {r.createdBlock}
          </li>
        ))}
      </ul>
    </section>
  );
}
