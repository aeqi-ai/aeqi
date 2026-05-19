import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useUIStore } from "@/store/ui";
import { useActiveEntity } from "@/queries/entities";
import BlockAvatar from "@/components/BlockAvatar";

/**
 * Acting-as selector — the trust credential card in the sidebar's TRUST
 * group. Vertical layout: trust avatar at top, trust name beneath, role
 * caption below in caps. Reads as "you are <ROLE> inside <TRUST>".
 *
 * Sits directly inside `.sidebar-surface-nav` (no extra wrapper) so the
 * black card spans the same outer width as the nav rows above and below.
 *
 * Click navigates to `/identity` where the user can switch contexts.
 *
 * MVP wiring: trust = the active entity, role is a stub label until the
 * runtime exposes "current acting role" per (user × trust).
 */
export default function ActingAsSelector() {
  const navigate = useNavigate();
  const activeEntityId = useUIStore((s) => s.activeEntity);
  const activeEntity = useActiveEntity(activeEntityId);

  const trustName = activeEntity?.name?.trim() || "Select a trust";
  const roleName = "Director";

  return (
    <button
      type="button"
      className="acting-as-trigger"
      onClick={() => navigate("/identity")}
      aria-label={`Switch context · currently ${roleName} at ${trustName}`}
    >
      <span className="acting-as-chevron" aria-hidden="true">
        <ChevronRight size={12} strokeWidth={2} />
      </span>
      <span className="acting-as-badge acting-as-badge--expanded" aria-hidden="true">
        <BlockAvatar name={trustName} size={36} />
      </span>
      <span className="acting-as-badge acting-as-badge--collapsed" aria-hidden="true">
        <BlockAvatar name={trustName} size={18} />
      </span>
      <span className="acting-as-trust">{trustName}</span>
      <span className="acting-as-role">{roleName}</span>
    </button>
  );
}
