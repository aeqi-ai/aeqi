import { EmptyState } from "@/components/ui";

/**
 * Economy — the marketplace / inference / billing destination at /economy.
 *
 * Top-level (user-scoped, not per-trust) surface introduced 2026-05-18 as
 * part of the "Global" sidebar group. Marketplace + Inference will live as
 * tabs/sub-pages of this surface; for now a single EmptyState mirrors the
 * AssetsPage / EquityPage / QuorumPage / IncorporationPage stub pattern.
 */
export default function EconomyPage() {
  return (
    <div
      className="ideas-canvas"
      style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1 }}
    >
      <EmptyState
        title="Economy"
        description="Marketplace, inference, billing — the global economy surface. Coming together soon."
      />
    </div>
  );
}
