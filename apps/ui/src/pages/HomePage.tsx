import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import BlockAvatar from "@/components/BlockAvatar";
import UserAvatar from "@/components/UserAvatar";
import { useAuthStore } from "@/store/auth";
import { useEntities } from "@/queries/entities";

/**
 * Home — the root `/` surface. Personal greeting at the top anchors the
 * user; below it, a node-grid of the (actor × role × trust) contexts they
 * can step into. The grid always ends on a "+ Create new trust" tile so
 * creation is a peer affordance to selection, not a separate footer
 * button row.
 *
 * Visual intent (ethereal / character-selection): centred large user
 * avatar at top, display typography for the greeting, generous gaps,
 * soft hover lift. Per .impeccable.md: no hairlines, no gradients, no
 * animations beyond 0.12s ease — the "ethereal" comes from composition
 * and whitespace, not flourish.
 *
 * MVP data: actor = the signed-in user, trust = each entity from
 * `useEntities()`, role = stub label pending a runtime per-user × per-
 * trust role surface. Each card renders BlockAvatar + actor + role · trust.
 */
export default function HomePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const entities = useEntities();

  const actorName = useMemo(() => user?.name?.trim() || user?.email?.split("@")[0] || "—", [user]);

  const contexts = useMemo(
    () =>
      entities.map((entity) => ({
        id: entity.id,
        actor: actorName,
        role: "Director",
        trust: entity.name,
        href: `/trust/${encodeURIComponent(entity.id)}`,
      })),
    [entities, actorName],
  );

  return (
    <div className="home-picker">
      <div className="home-picker-anchor">
        <span className="home-picker-anchor-avatar">
          <UserAvatar name={actorName} src={user?.avatar_url} size={64} />
        </span>
        <h1 className="home-picker-greeting">Hello, {actorName}.</h1>
        <p className="home-picker-subhead">Pick a context to step into.</p>
      </div>

      <div className="home-picker-grid" role="list">
        {contexts.map((ctx) => (
          <button
            key={ctx.id}
            type="button"
            role="listitem"
            className="home-picker-node"
            onClick={() => navigate(ctx.href)}
            aria-label={`${ctx.actor}, ${ctx.role} at ${ctx.trust}`}
          >
            <span className="home-picker-node-avatar">
              <BlockAvatar name={ctx.trust} size={64} />
            </span>
            <span className="home-picker-node-actor">{ctx.actor}</span>
            <span className="home-picker-node-context">
              {ctx.role} · {ctx.trust}
            </span>
          </button>
        ))}
        <button
          type="button"
          role="listitem"
          className="home-picker-node home-picker-node--create"
          onClick={() => navigate("/launch")}
          aria-label="Create a new trust"
        >
          <span className="home-picker-node-avatar home-picker-node-avatar--ghost">
            <Plus size={28} strokeWidth={1.5} />
          </span>
          <span className="home-picker-node-actor">New trust</span>
          <span className="home-picker-node-context">Start something fresh</span>
        </button>
      </div>

      <footer className="home-picker-footer">
        <button type="button" className="home-picker-link" onClick={() => navigate("/blueprints")}>
          Browse blueprints
        </button>
        <span className="home-picker-link-sep" aria-hidden="true">
          ·
        </span>
        <button
          type="button"
          className="home-picker-link home-picker-link--muted"
          disabled
          title="Coming soon"
        >
          View network map
        </button>
      </footer>
    </div>
  );
}
