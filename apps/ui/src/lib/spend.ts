/**
 * Per-agent inference-spend display formatter.
 *
 * Brief contract (Inference accounting Z2):
 *   - Zero spend renders as `$0.00` (concise, no false precision).
 *   - Non-zero spend renders to 4 decimal places (`$0.0123`) so micro-
 *     costs from cheap models stay visible — `$0.00` would lie about a
 *     real 0.4¢ call.
 *   - Output is right-alignable (no symbols beyond `$` and digits).
 *
 * Used by: agents-list Spend column, Agent Treasury tab Lifetime Spend
 * stat, recent-calls per-row Cost column.
 */
export function formatSpendUsd(usd: number | null | undefined): string {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return "$0.00";
  if (usd === 0) return "$0.00";
  return `$${usd.toFixed(4)}`;
}
