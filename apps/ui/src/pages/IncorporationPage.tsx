import { EmptyState } from "@/components/ui";

/**
 * Incorporation — `i` in the AEQI grammar (assets · equity · quorum · incorporation).
 *
 * The TRUST's constitutional surface: charter / operating agreement, founder
 * roster, registration metadata. Split out of the previous "Identity" tab on
 * 2026-05-18 so the role-graph could move up to its own peer slot under Trust
 * (see TrustRolesTab + the sidebar's `Roles` row). Incorporation holds founding
 * artifacts; Roles holds the live authority graph.
 *
 * Placeholder pending the real founding-document surface.
 */
export default function IncorporationPage() {
  return (
    <div
      className="ideas-canvas"
      style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1 }}
    >
      <EmptyState
        title="Incorporation"
        description="How the TRUST came into being — charter, founders, registration. Coming together soon."
      />
    </div>
  );
}
