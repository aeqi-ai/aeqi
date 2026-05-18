import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { useUIStore } from "@/store/ui";
import { useActiveEntity } from "@/queries/entities";

/**
 * Acting-as selector — the main accent block in the sidebar. Two-line
 * content stack (the explicit "Acting as" eyebrow was dropped 2026-05-18
 * along with the URL rename; the page itself describes what's being
 * picked, so the rail block stays quiet):
 *
 *   <Actor name>       (the entity/user the request runs as)
 *   <Role> · <Trust>   (the role within the trust)
 *
 * Click navigates to `/` — the home picker page (HomePage) where the user
 * steps into a different (actor × role × trust) context.
 *
 * MVP wiring: actor = the logged-in user, trust = the active entity, role
 * is a stub label until the runtime exposes "current acting role" on a
 * per-user × per-trust basis. The black-accent treatment is intentional;
 * this surface defines the operating context for every other panel.
 */
export default function ActingAsSelector() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const activeEntityId = useUIStore((s) => s.activeEntity);
  const activeEntity = useActiveEntity(activeEntityId);

  const actorName = user?.name?.trim() || user?.email?.split("@")[0] || "—";
  const trustName = activeEntity?.name?.trim() || "Select a trust";
  // TODO: source from runtime when "current acting role" is wired per
  // user × trust. Stub label keeps the visual frame stable.
  const roleName = "Director";
  const contextLine = trustName === "Select a trust" ? roleName : `${roleName} · ${trustName}`;

  return (
    <button
      type="button"
      className="acting-as-trigger"
      onClick={() => navigate("/")}
      aria-label="Switch operating context"
    >
      <span className="acting-as-actor">{actorName}</span>
      <span className="acting-as-context">{contextLine}</span>
    </button>
  );
}
