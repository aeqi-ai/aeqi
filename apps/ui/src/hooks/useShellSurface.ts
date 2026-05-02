import { useMemo } from "react";

/**
 * Pure derivation: turn the current URL state into a set of named
 * surface flags the AppLayout shell can switch on. Lifted out of
 * AppLayout because the regex-and-flag soup obscured the actual
 * rendering logic — and because every flag is a function of two cheap
 * inputs (path, tab), so a single `useMemo` is cheaper than the inline
 * derivations it replaces.
 */
export interface ShellSurface {
  isSettings: boolean;
  isEconomy: boolean;
  isBlueprints: boolean;
  isDrive: boolean;
  isStart: boolean;
  /** True when the path doesn't match any known shell surface — drives the
   *  in-shell 404 dispatch. Stays false for `/`, `/me/...`, `/start`,
   *  `/economy/...`, `/blueprints/...`, and `/c/:entityId/...`. */
  isNotFound: boolean;
  /** `/` — the global human action queue (Inbox is the canonical root). */
  isMyInbox: boolean;
  /** `/me/portfolio` — personal cross-company view (holdings, performance). */
  isPortfolio: boolean;
}

export function useShellSurface(path: string, tab: string | undefined): ShellSurface {
  return useMemo(() => {
    // Inbox lives at root. The user-scope namespace `/me/*` is split:
    //   - portfolio: /me/portfolio (cross-company holdings/performance)
    //   - settings:  /me, /me/profile, /me/billing, /me/security, …
    // Settings owns the /me/* catch-all so unrecognised /me/<x> still
    // falls back to ProfilePage rather than 404. Portfolio carves
    // out one specific path before settings resolves it.
    const isMyInbox = path === "/";
    const isPortfolio = path === "/me/portfolio";
    const isSettings =
      !isPortfolio && (path === "/me" || path.startsWith("/me/") || tab === "profile");
    const isEconomy = path === "/economy" || path.startsWith("/economy/");
    const isBlueprints = path === "/blueprints" || path.startsWith("/blueprints/");
    const isStart = path === "/start" || path.startsWith("/start/");
    const isDrive = tab === "drive";

    // A path is "known" when it matches one of the registered shell
    // surfaces. Anything else is a 404 — including bogus top-level
    // segments (`/foo`) that would otherwise fall through to a stale
    // active-entity render.
    const isCompanyRoute = path === "/" || /^\/c\/[^/]+(\/|$)/.test(path);
    const isKnownShellRoute =
      isCompanyRoute ||
      isPortfolio ||
      isSettings ||
      isEconomy ||
      isBlueprints ||
      isStart ||
      isMyInbox;
    const isNotFound = !isKnownShellRoute;

    return {
      isSettings,
      isEconomy,
      isBlueprints,
      isDrive,
      isStart,
      isNotFound,
      isMyInbox,
      isPortfolio,
    };
  }, [path, tab]);
}
