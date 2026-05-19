import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useUIStore } from "@/store/ui";
import { useActiveEntity } from "@/queries/entities";

/**
 * Acting-as selector — the accent block in the sidebar's "Identity"
 * group. Two-line text + right-aligned chevron:
 *
 *   <Role>            (top line, bolder)
 *   <Trust name>      (bottom line, secondary)        [›]
 *
 * The trust avatar was tried inside this block but eats horizontal
 * width that long trust names need ("Aurora Decentralized Foundation
 * Holdings" etc). The IDENTITY group label + the role/trust pair
 * carry the badge meaning without the icon.
 *
 * Click navigates to `/identity` where the user can switch contexts.
 *
 * MVP wiring: trust = the active entity, role is a stub label until
 * the runtime exposes "current acting role" per (user × trust).
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
      <span className="acting-as-text">
        <span className="acting-as-role">{roleName}</span>
        <span className="acting-as-trust">{trustName}</span>
      </span>
      <span className="acting-as-chevron" aria-hidden="true">
        <ChevronRight size={14} strokeWidth={2} />
      </span>
    </button>
  );
}
