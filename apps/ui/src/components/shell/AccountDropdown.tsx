import { useCallback, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Popover, SelectOption } from "@/components/ui";
import UserAvatar from "@/components/UserAvatar";
import { useAuthStore } from "@/store/auth";
import { Events, useTrack } from "@/lib/analytics";

const iconProps = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const AccountIcon = () => (
  <svg {...iconProps}>
    <circle cx="8" cy="5.5" r="2.5" />
    <path d="M3 13.5c0-2.5 2-4.5 5-4.5s5 2 5 4.5" />
  </svg>
);

const InboxIcon = () => (
  <svg {...iconProps}>
    <path d="M2 8.5 4 3h8l2 5.5v4.5H2z" />
    <path d="M2 8.5h3.5l1 1.5h3l1-1.5H14" />
  </svg>
);

const BillingIcon = () => (
  <svg {...iconProps}>
    <rect x="2" y="4" width="12" height="9" rx="1" />
    <path d="M2 7h12" />
    <path d="M5 10.5h3" />
  </svg>
);

const NotificationsIcon = () => (
  <svg {...iconProps}>
    <path d="M8 2a2 2 0 0 1 2 2v.5c1.5.5 2.5 2 2.5 3.5H3.5C3.5 6.5 4.5 5 6 4.5V4a2 2 0 0 1 2-2z" />
    <path d="M5.5 12a2.5 2.5 0 0 0 5 0" />
  </svg>
);

const SignOutIcon = () => (
  <svg {...iconProps}>
    <path d="M9 3H3v10h6" />
    <path d="M7 8h7M11 5l3 3-3 3" />
  </svg>
);

// Small ⋯ glyph — same affordance vocabulary as a "more" menu trigger.
// Sits right of the user identity, opens the secondary actions popover
// without competing with the row's primary navigation click.
const MoreIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
  >
    <circle cx="3" cy="8" r="1.25" />
    <circle cx="8" cy="8" r="1.25" />
    <circle cx="13" cy="8" r="1.25" />
  </svg>
);

export default function AccountDropdown() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const user = useAuthStore((s) => s.user);
  const authMode = useAuthStore((s) => s.authMode);
  const logout = useAuthStore((s) => s.logout);
  const track = useTrack();
  const [open, setOpen] = useState(false);

  const isAccount =
    (pathname === "/me" || pathname.startsWith("/me/")) && pathname !== "/me/billing";
  const isPersonalInbox = pathname === "/";
  const isBilling = pathname === "/me/billing";
  // Row-level "active" — highlighted whenever we're somewhere under /me.
  // Same vocabulary the trigger had before; just lifted onto the Link.
  const rowActive = pathname === "/me" || pathname.startsWith("/me/");

  const userName =
    user?.name || user?.email?.split("@")[0] || (authMode === "none" ? "Local" : "You");
  const userEmail = user?.name && user?.email ? user.email : null;

  const go = useCallback(
    (to: string) => {
      navigate(to);
      setOpen(false);
    },
    [navigate],
  );

  const signOut = useCallback(() => {
    track(Events.AuthLogout, { surface: "account-dropdown" });
    logout();
    setOpen(false);
    navigate("/login");
  }, [track, logout, navigate]);

  // Local-mode (no auth) keeps the old single-trigger shape — there
  // are no secondary actions to surface, and there's no /me route to
  // navigate to. Render the bare identity tile; click is a no-op.
  if (authMode === "none") {
    return (
      <div className="account-dropdown-row">
        <div
          className="account-dropdown-trigger account-dropdown-trigger--static"
          aria-label="Local mode"
        >
          <span className="account-dropdown-avatar">
            <UserAvatar name={userName} size={16} src={user?.avatar_url} />
          </span>
          <span className="account-dropdown-identity">
            <span className="account-dropdown-name">Local mode</span>
          </span>
        </div>
      </div>
    );
  }

  // Primary affordance: the row IS a Link to /me. Click navigates,
  // no popover side-effect. Keyboard activation (Enter/Space) routes
  // identically — Link delegates to React Router. The chevron sibling
  // is the secondary affordance for sign-out / billing / inbox.
  const chevronTrigger = (
    <button
      type="button"
      className="account-dropdown-chevron"
      aria-label="Account menu"
      aria-haspopup="menu"
    >
      <MoreIcon />
    </button>
  );

  return (
    <div className="account-dropdown-row">
      <Link
        to="/me"
        className={`account-dropdown-trigger${rowActive ? " account-dropdown-trigger--active" : ""}`}
        aria-current={rowActive ? "page" : undefined}
      >
        <span className="account-dropdown-avatar">
          <UserAvatar name={userName} size={16} src={user?.avatar_url} />
        </span>
        <span className="account-dropdown-identity">
          <span className="account-dropdown-name">{userName}</span>
          {userEmail && (
            <span className="account-dropdown-email" title={userEmail}>
              {userEmail}
            </span>
          )}
        </span>
      </Link>
      <Popover
        trigger={chevronTrigger}
        open={open}
        onOpenChange={setOpen}
        placement="top-end"
        portal
      >
        <div className="account-dropdown-menu" role="menu">
          <SelectOption
            selected={isAccount}
            onClick={() => go("/me")}
            leadingIcon={<AccountIcon />}
          >
            Account
          </SelectOption>
          <SelectOption
            selected={isPersonalInbox}
            onClick={() => go("/")}
            leadingIcon={<InboxIcon />}
          >
            Personal Inbox
          </SelectOption>
          <SelectOption
            disabled
            leadingIcon={<NotificationsIcon />}
            trailingHint="soon"
            title="Coming soon"
          >
            Notifications
          </SelectOption>
          <SelectOption
            selected={isBilling}
            onClick={() => go("/me/billing")}
            leadingIcon={<BillingIcon />}
          >
            Billing
          </SelectOption>
          <SelectOption onClick={signOut} leadingIcon={<SignOutIcon />}>
            Log out
          </SelectOption>
        </div>
      </Popover>
    </div>
  );
}
