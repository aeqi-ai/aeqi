/**
 * Structured error-logging primitive.
 *
 * The CLAUDE.md audit pass on 2026-05-14 flagged 12 `.catch(() => {})`
 * sites across critical paths (auth panels, session manager, WebSocket
 * chat, agent picker popovers). Each silently swallowed network /
 * fetch errors, leaving the UI stuck (empty picker, frozen session,
 * blank settings) with no clue in dev tools.
 *
 * Use `logError(scope, err)` in EVERY `.catch()` where the error is
 * non-fatal (the UI can degrade gracefully) but the failure is still
 * worth surfacing for debugging. The scope label is grep-able and
 * shows up as a `[<scope>]` prefix in the console.
 *
 * If the failure is fatal — the user should SEE an error state in the
 * UI — `.catch()` should `setError(...)` (or equivalent), not just
 * call `logError`. This helper is the band-aid that ends silence; it
 * is NOT a replacement for user-facing error UX.
 *
 * Future hook (NOT yet wired): route through a telemetry backend
 * (Sentry, datadog, the platform's own error sink). Single hook here
 * means we don't have to revisit every call site when that backend
 * lands. For now: console.warn is enough; the goal is "no silent
 * failures," not "perfect observability."
 */
export function logError(scope: string, err: unknown): void {
  if (typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn(`[${scope}]`, err);
  }
}
