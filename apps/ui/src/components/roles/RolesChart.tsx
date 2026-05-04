import { useMemo } from "react";
import type { Role, RoleEdge } from "@/lib/types";
import RoleNode from "./RoleNode";
import { layoutChart, NODE_H, NODE_W } from "./layout";

export interface RolesChartProps {
  roles: Role[];
  edges: RoleEdge[];
  agentNames: Map<string, string>;
  onSelectRole: (role: Role) => void;
}

/**
 * Three-band org surface:
 *
 *   BOARD       — directors as a horizontal roster (no edges drawn).
 *                 Governance is not reporting; the board is appointed,
 *                 not managed, so a bezier into the operational tree
 *                 would be a category error.
 *   ORG         — operational roles as a layered DAG (Sugiyama-lite,
 *                 see `./layout.ts`). Same algorithm as before, just
 *                 fed only operational roles + their edges.
 *   ADVISORS    — advisors as a trailing horizontal roster.
 *
 * Empty bands collapse entirely. Cross-band edges are dropped silently
 * — current data shouldn't have them; if it does, they're stale.
 */
export default function RolesChart({ roles, edges, agentNames, onSelectRole }: RolesChartProps) {
  const directors = useMemo(() => roles.filter((r) => r.role_type === "director"), [roles]);
  const advisors = useMemo(() => roles.filter((r) => r.role_type === "advisor"), [roles]);
  const operational = useMemo(() => roles.filter((r) => r.role_type === "operational"), [roles]);

  const opLayout = useMemo(() => {
    const opIds = new Set(operational.map((r) => r.id));
    const opEdges = edges.filter((e) => opIds.has(e.parent_role_id) && opIds.has(e.child_role_id));
    return layoutChart(operational, opEdges);
  }, [operational, edges]);

  if (roles.length === 0) return null;

  return (
    <div className="roles-chart-scroll">
      <div className="roles-chart-stack">
        {directors.length > 0 && (
          <RolesBand
            label="Board"
            roles={directors}
            agentNames={agentNames}
            onSelect={onSelectRole}
          />
        )}
        {opLayout.nodes.length > 0 && (
          <section className="roles-chart-zone" aria-label="Org">
            <div className="roles-chart-zone-eyebrow">Org</div>
            <div
              className="roles-chart-canvas"
              style={{ width: opLayout.width, height: opLayout.height }}
              role="figure"
              aria-label="Organisation chart"
            >
              <svg
                className="roles-chart-edges"
                width={opLayout.width}
                height={opLayout.height}
                viewBox={`0 0 ${opLayout.width} ${opLayout.height}`}
                aria-hidden
              >
                {opLayout.edges.map((e, i) => {
                  const x1 = e.from.x + NODE_W / 2;
                  const y1 = e.from.y + NODE_H;
                  const x2 = e.to.x + NODE_W / 2;
                  const y2 = e.to.y;
                  const midY = (y1 + y2) / 2;
                  const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
                  return <path key={i} d={d} className="roles-chart-edge-path" />;
                })}
              </svg>
              {opLayout.nodes.map((n) => (
                <RoleNode
                  key={n.role.id}
                  role={n.role}
                  agentName={n.role.occupant_id ? agentNames.get(n.role.occupant_id) : undefined}
                  onClick={() => onSelectRole(n.role)}
                  style={{
                    position: "absolute",
                    left: n.x,
                    top: n.y,
                    width: NODE_W,
                    height: NODE_H,
                  }}
                />
              ))}
            </div>
          </section>
        )}
        {advisors.length > 0 && (
          <RolesBand
            label="Advisors"
            roles={advisors}
            agentNames={agentNames}
            onSelect={onSelectRole}
          />
        )}
      </div>
    </div>
  );
}

interface RolesBandProps {
  label: string;
  roles: Role[];
  agentNames: Map<string, string>;
  onSelect: (role: Role) => void;
}

function RolesBand({ label, roles, agentNames, onSelect }: RolesBandProps) {
  return (
    <section className="roles-chart-zone" aria-label={label}>
      <div className="roles-chart-zone-eyebrow">{label}</div>
      <div className="roles-chart-roster">
        {roles.map((r) => (
          <RoleNode
            key={r.id}
            role={r}
            agentName={r.occupant_id ? agentNames.get(r.occupant_id) : undefined}
            onClick={() => onSelect(r)}
            style={{ width: NODE_W, height: NODE_H }}
          />
        ))}
      </div>
    </section>
  );
}
