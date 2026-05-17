import { EmptyState } from "@/components/ui";

/**
 * Assets — `a` in the AEQI grammar (assets · equity · quorum · identity).
 *
 * Placeholder surface ahead of the real TRUST-assets implementation. The
 * predecessor TreasuryPage was retired alongside Ownership and Governance
 * (commit 4a197188) so this stub holds the AEQI sidebar grammar without
 * resurrecting deleted code we did not intend to keep. Build the real
 * holdings + transfers + budget surfaces in a focused follow-up.
 */
export default function AssetsPage() {
  return (
    <div
      className="ideas-canvas"
      style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1 }}
    >
      <EmptyState
        title="Assets"
        description="What the TRUST holds — balances, transfers, budgets. Coming together soon."
      />
    </div>
  );
}
