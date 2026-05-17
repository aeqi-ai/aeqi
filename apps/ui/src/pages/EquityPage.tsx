import { EmptyState } from "@/components/ui";

/**
 * Equity — `e` in the AEQI grammar (assets · equity · quorum · identity).
 *
 * Placeholder ahead of the real cap-table surface. The predecessor
 * OwnershipPage was retired with the treasury/governance trio (commit
 * 4a197188); this stub anchors the AEQI sidebar without dragging back
 * the prior implementation. Build the real cap-table / share-class /
 * stakeholder view in a focused follow-up.
 */
export default function EquityPage() {
  return (
    <div
      className="ideas-canvas"
      style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1 }}
    >
      <EmptyState
        title="Equity"
        description="Who owns what — cap table, share classes, stakeholders. Coming together soon."
      />
    </div>
  );
}
