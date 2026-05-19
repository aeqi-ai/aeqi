import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import BlockAvatar from "@/components/BlockAvatar";
import UserAvatar from "@/components/UserAvatar";
import { useAuthStore } from "@/store/auth";
import { useEntities } from "@/queries/entities";

/**
 * Network — the dominion / constellation view at `/network`. The user is
 * the centre node; each trust they hold a role in radiates out from
 * them; the line between user and trust IS the role (the connection in
 * the authority graph). Picking a node enters that operating context.
 *
 * Layout: static concentric ring (not force-directed). Trusts position
 * themselves evenly around the centre starting from 12 o'clock. The
 * "+" tile sits as one extra node on the ring so creation reads as a
 * peer affordance to selection — exactly the shape the user described.
 *
 * Per .impeccable.md: no decorative motion, no gradients. Lines are
 * pure-neutral stroke. Hover scales node + brightens line; that's it.
 */
export default function HomePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const entities = useEntities();

  const actorName = useMemo(
    () => user?.name?.trim() || user?.email?.split("@")[0] || "you",
    [user],
  );

  const nodes = useMemo(() => {
    const trusts = entities.map((entity) => ({
      kind: "trust" as const,
      id: entity.id,
      label: entity.name,
      role: "Director",
      href: `/trust/${encodeURIComponent(entity.id)}`,
    }));
    return [...trusts, { kind: "create" as const, id: "__create" }];
  }, [entities]);

  const positions = useMemo(() => {
    const n = nodes.length;
    const radius = n === 1 ? 30 : 36;
    return nodes.map((_, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      return {
        leftPct: 50 + radius * Math.cos(angle),
        topPct: 50 + radius * Math.sin(angle),
      };
    });
  }, [nodes]);

  return (
    <div className="constellation-page">
      <div className="constellation-canvas" role="list" aria-label="Your network">
        <svg
          className="constellation-lines"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {nodes.map((node, i) => {
            const { leftPct, topPct } = positions[i];
            const isCreate = node.kind === "create";
            return (
              <line
                key={`line-${node.id}`}
                x1={50}
                y1={50}
                x2={leftPct}
                y2={topPct}
                className={`constellation-line${isCreate ? " constellation-line--create" : ""}`}
              />
            );
          })}
        </svg>

        {nodes.map((node, i) => {
          if (node.kind !== "trust") return null;
          const { leftPct, topPct } = positions[i];
          const midLeft = (50 + leftPct) / 2;
          const midTop = (50 + topPct) / 2;
          return (
            <span
              key={`role-${node.id}`}
              className="constellation-role-label"
              style={{ left: `${midLeft}%`, top: `${midTop}%` }}
              aria-hidden="true"
            >
              {node.role}
            </span>
          );
        })}

        <div className="constellation-self">
          <span className="constellation-self-avatar">
            <UserAvatar name={actorName} src={user?.avatar_url} size={80} />
          </span>
          <span className="constellation-self-label">{actorName}</span>
        </div>

        {nodes.map((node, i) => {
          const { leftPct, topPct } = positions[i];
          if (node.kind === "create") {
            return (
              <button
                key={node.id}
                type="button"
                role="listitem"
                className="constellation-node constellation-node--create"
                style={{ left: `${leftPct}%`, top: `${topPct}%` }}
                onClick={() => navigate("/launch")}
                aria-label="Create a new trust"
              >
                <span className="constellation-node-avatar constellation-node-avatar--ghost">
                  <Plus size={22} strokeWidth={1.5} />
                </span>
                <span className="constellation-node-label">New trust</span>
              </button>
            );
          }
          return (
            <button
              key={node.id}
              type="button"
              role="listitem"
              className="constellation-node"
              style={{ left: `${leftPct}%`, top: `${topPct}%` }}
              onClick={() => navigate(node.href)}
              aria-label={`${node.role} at ${node.label}`}
            >
              <span className="constellation-node-avatar">
                <BlockAvatar name={node.label} size={64} />
              </span>
              <span className="constellation-node-label">{node.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
