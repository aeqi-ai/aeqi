import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Input } from "@/components/ui";
import { useAuthStore } from "@/store/auth";
import { useEntities } from "@/queries/entities";

/**
 * Acting-as page — the full surface for picking actor + role + trust as a
 * single operating-context tuple.
 *
 * The canonical model is Actor → Role → Trust: the user (or an entity
 * acting on their behalf) selects WHICH actor identity, WHICH role within
 * that actor's available role set, and WHICH trust the role belongs to.
 * The sidebar's accent block displays the current tuple; this page is
 * where it gets changed.
 *
 * MVP scope: render the canonical layout (header + search + recent +
 * grouped contexts + actions). Context rows display real trusts from
 * `useEntities()`; actor/role tuples use stub labels until the runtime
 * exposes a `(user_id × trust_id × role_id)` listing. The action buttons
 * are wired through to existing surfaces (`/launch` for create, no
 * navigation yet for blueprints / network map).
 */
export default function ActingAsPage() {
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
    <div className="acting-as-page">
      <header className="acting-as-header">
        <h1>Acting as</h1>
        <p>Select the actor, role, and trust you want to operate from.</p>
      </header>

      <div className="acting-as-search">
        <Input placeholder="Search actors, roles, trusts" aria-label="Search contexts" />
      </div>

      {contexts.length > 0 && (
        <section className="acting-as-section">
          <h2 className="acting-as-section-title">Recent contexts</h2>
          <ul className="acting-as-list">
            {contexts.slice(0, 3).map((ctx) => (
              <li key={`recent-${ctx.id}`}>
                <button type="button" className="acting-as-row" onClick={() => navigate(ctx.href)}>
                  <span className="acting-as-row-actor">{ctx.actor}</span>
                  <span className="acting-as-row-context">
                    {ctx.role} · {ctx.trust}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="acting-as-section">
        <h2 className="acting-as-section-title">Available contexts</h2>
        {contexts.length === 0 ? (
          <p className="acting-as-empty">No trusts yet. Use the action below to create one.</p>
        ) : (
          <ul className="acting-as-list">
            {contexts.map((ctx) => (
              <li key={ctx.id}>
                <button type="button" className="acting-as-row" onClick={() => navigate(ctx.href)}>
                  <span className="acting-as-row-actor">{ctx.actor}</span>
                  <span className="acting-as-row-context">
                    {ctx.role} · {ctx.trust}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="acting-as-actions">
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
