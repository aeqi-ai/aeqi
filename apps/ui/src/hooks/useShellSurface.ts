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
  /** `/economy/*` — top-level marketplace / inference / billing destination
   *  introduced as part of the "Global" sidebar group on 2026-05-18. */
  isEconomy: boolean;
  /** `/acting-as` — the operating-context picker (Actor × Role × Trust)
   *  reached from the sidebar's main accent block. */
  isActingAs: boolean;
  /** True when the path doesn't match any known shell surface — drives the
   *  in-shell 404 dispatch. Stays false for `/me/...`, `/launch/...`,
   *  `/blueprints/...`, and other non-organization routes. */
  isNotFound: boolean;
  /** `/admin` — operator dashboard. Backend gates on is_admin; the page
   *  itself returns null + bounces non-admins. */
  isAdmin: boolean;
  /** In-shell Roles sub-pages — rendered inside AppLayout. The Roles
   *  primitive moved out of the AEQI Ownership group on 2026-05-18 to a
   *  peer slot directly under Trust (see CompanyPage `tab === "roles"`).
   *  URL slug is `/roles/...`; underlying page components are RoleNewPage /
   *  RoleDetailPage / RoleEditPage / RoleInvitePage. */
  isRolesNew: boolean;
  isRolesDetail: boolean;
  isRolesEdit: boolean;
  isRolesInvite: boolean;
}

export function useShellSurface(path: string): ShellSurface {
  return useMemo(() => {
    const isAdmin = path === "/admin" || path.startsWith("/admin/");
    // All /account/* paths are handled by ProfilePage.
    const isAccount = path === "/account" || path.startsWith("/account/");
    const isBlueprints = path === "/blueprints" || path.startsWith("/blueprints/");
    const isLaunch = path === "/launch" || path.startsWith("/launch/");
    const isEconomy = path === "/economy" || path.startsWith("/economy/");
    const isActingAs = path === "/acting-as" || path.startsWith("/acting-as/");

    // In-shell Roles sub-pages on the canonical trust route. URL slug is
    // `/roles/...`; underlying pages are RoleNewPage / RoleDetailPage /
    // RoleEditPage / RoleInvitePage.
    const rolesPathMatch = path.match(/^\/trust\/[^/]+\/roles\/(.+)$/);
    const rolesSuffix = rolesPathMatch ? rolesPathMatch[1] : null;
    const isRolesNew = rolesSuffix === "new";
    const isRolesInvite = !isRolesNew && !!rolesSuffix && rolesSuffix.endsWith("/invite");
    const isRolesEdit = !isRolesNew && !!rolesSuffix && rolesSuffix.endsWith("/edit");
    const isRolesDetail =
      !isRolesNew && !isRolesInvite && !isRolesEdit && !!rolesSuffix && !rolesSuffix.includes("/");

    // A path is "known" when it matches one of the registered shell
    // surfaces. Anything else is a 404 — including bogus top-level
    // segments (`/foo`) that would otherwise fall through to a stale
    // active-entity render.
    const isCompanyRoute = /^\/trust\/[^/]+(\/|$)/.test(path);
    const isKnownShellRoute =
      isCompanyRoute || isAccount || isBlueprints || isLaunch || isEconomy || isActingAs || isAdmin;
    const isNotFound = !isKnownShellRoute;

    return {
      isAccount,
      isBlueprints,
      isLaunch,
      isEconomy,
      isActingAs,
      isNotFound,
      isAdmin,
      isRolesNew,
      isRolesDetail,
      isRolesEdit,
      isRolesInvite,
    };
  }, [path]);
}
