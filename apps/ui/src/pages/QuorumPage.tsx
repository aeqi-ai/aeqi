import { EmptyState } from "@/components/ui";

/**
 * Quorum — `q` in the AEQI grammar (assets · equity · quorum · identity).
 *
 * Placeholder ahead of the real governance / proposal / voting surface.
 * The predecessor GovernancePage was retired with the treasury/ownership
 * trio (commit 4a197188); this stub anchors the AEQI sidebar without
 * dragging back the prior implementation. Build the real proposal +
 * voting + thresholds surface in a focused follow-up.
 */
export default function QuorumPage() {
  return (
    <div
      className="ideas-canvas"
      style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1 }}
    >
      <EmptyState
        title="Quorum"
        description="How the TRUST decides — proposals, votes, thresholds. Coming together soon."
      />
    </div>
  );
}
