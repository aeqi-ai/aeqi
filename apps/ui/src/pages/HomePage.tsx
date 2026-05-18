import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui";
import BlockAvatar from "@/components/BlockAvatar";
import { useAuthStore } from "@/store/auth";
import { useEntities } from "@/queries/entities";

/**
 * Home — the root `/` surface. The first thing the user sees after sign-in:
 * a quiet node-grid of the (actor × role × trust) contexts they can step
 * into. Picking a node enters that operating context.
 *
 * Intentionally drops the "Acting as" jargon from the earlier ActingAsPage.
 * The surface should feel ethereal — generous whitespace, low-density,
 * soft hover — rather than a settings panel.
 *
 * MVP data: actor = the signed-in user, trust = each entity from
 * `useEntities()`, role = stub label pending the runtime's per-user × per-
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
      <header className="home-picker-header">
        <h1>Step into a context.</h1>
        <p>Pick the actor, role, and trust you want to operate from.</p>
      </header>

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
              <BlockAvatar name={ctx.trust} size={56} />
            </span>
            <span className="home-picker-node-actor">{ctx.actor}</span>
            <span className="home-picker-node-context">
              {ctx.role} · {ctx.trust}
            </span>
          </button>
        ))}
      </div>

      {contexts.length === 0 && (
        <p className="home-picker-empty">
          You don&apos;t have any trusts yet. Start by creating one.
        </p>
      )}

      <div className="home-picker-actions">
        <Button variant="primary" onClick={() => navigate("/launch")}>
          + Create new trust
        </Button>
        <Button variant="ghost" onClick={() => navigate("/blueprints")}>
          Browse blueprints
        </Button>
        <Button variant="ghost" disabled title="Coming soon">
          View network map
        </Button>
      </div>
    </div>
  );
}
