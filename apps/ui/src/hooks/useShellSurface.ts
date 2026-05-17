import { useMemo } from "react";

/**
 * Pure derivation: turn the current URL path into a set of named surface
 * flags the AppLayout shell can switch on. Lifted out of AppLayout
 * because the regex-and-flag soup obscured the actual rendering logic.
 *
 * The shell now treats the launch surface and the company surfaces as
 * first-class routes. The user-scope MVP entrypoint is `/launch`.
 */
export interface ShellSurface {
  /** True for all `/account/*` paths — ProfilePage dispatches further. */
  isAccount: boolean;
  isBlueprints: boolean;
  /** `/launch` — company formation surface. Left composer + right canvas. */
  isLaunch: boolean;
  /** True when the path doesn't match any known shell surface — drives the
   *  in-shell 404 dispatch. Stays false for `/me/...`, `/launch/...`,
   *  `/blueprints/...`, and other non-organization routes. */
  isNotFound: boolean;
  /** `/admin` — operator dashboard. Backend gates on is_admin; the page
   *  itself returns null + bounces non-admins. */
  isAdmin: boolean;
  /** In-shell role pages — rendered inside AppLayout. */
  isRolesNew: boolean;
  isRoleDetail: boolean;
  isRoleEdit: boolean;
  isRoleInvite: boolean;
}

export function useShellSurface(path: string): ShellSurface {
  return useMemo(() => {
    const isAdmin = path === "/admin" || path.startsWith("/admin/");
    // All /account/* paths are handled by ProfilePage.
    const isAccount = path === "/account" || path.startsWith("/account/");
    const isBlueprints = path === "/blueprints" || path.startsWith("/blueprints/");
    const isLaunch = path === "/launch" || path.startsWith("/launch/");

    // In-shell role sub-pages on the canonical trust route.
    const rolePathMatch = path.match(/^\/trust\/[^/]+\/roles\/(.+)$/);
    const roleSuffix = rolePathMatch ? rolePathMatch[1] : null;
    const isRolesNew = roleSuffix === "new";
    const isRoleInvite = !isRolesNew && !!roleSuffix && roleSuffix.endsWith("/invite");
    const isRoleEdit = !isRolesNew && !!roleSuffix && roleSuffix.endsWith("/edit");
    const isRoleDetail =
      !isRolesNew && !isRoleInvite && !isRoleEdit && !!roleSuffix && !roleSuffix.includes("/");

    // A path is "known" when it matches one of the registered shell
    // surfaces. Anything else is a 404 — including bogus top-level
    // segments (`/foo`) that would otherwise fall through to a stale
    // active-entity render.
    const isCompanyRoute = /^\/trust\/[^/]+(\/|$)/.test(path);
    const isKnownShellRoute = isCompanyRoute || isAccount || isBlueprints || isLaunch || isAdmin;
    const isNotFound = !isKnownShellRoute;

    return {
      isAccount,
      isBlueprints,
      isLaunch,
      isNotFound,
      isAdmin,
      isRolesNew,
      isRoleDetail,
      isRoleEdit,
      isRoleInvite,
    };
  }, [path]);
}
