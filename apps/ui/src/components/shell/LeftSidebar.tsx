import { Link, useNavigate } from "react-router-dom";
import {
  Inbox,
  Landmark,
  Coins,
  PieChart,
  Vote,
  Workflow,
  Bot,
  Webhook,
  Target,
  Lightbulb,
  ScrollText,
} from "lucide-react";
import CompanySwitcher from "@/components/shell/CompanySwitcher";
import AccountDropdown from "@/components/shell/AccountDropdown";
import HelpMenu from "@/components/shell/HelpMenu";
import Wordmark from "@/components/Wordmark";
import { IconButton, Tooltip } from "@/components/ui";
import { useUIStore } from "@/store/ui";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import { entityBasePath } from "@/lib/entityPath";

interface LeftSidebarProps {
  /** Canonical entity (organization) id. Sidebar tabs are org-scoped, not child-agent scoped. */
  trustId: string | null;
  path: string;
}

const iconProps = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

// Sidebar nav icons — Lucide, sized via CSS (.sidebar-nav-item > svg).
// Stroke width is overridden to 1.65 by layout.css for the 16px optical sweet
// spot; the icon prop here just controls glyph identity.
const InboxIcon = () => <Inbox />;
const TrustIcon = () => <Landmark />;
const AgentsIcon = () => <Bot />;
const EventsIcon = () => <Webhook />;
const QuestsIcon = () => <Target />;
const IdeasIcon = () => <Lightbulb />;

// Stack of layered cards — Blueprints is the catalog of recipes, the
// supply layer of the system. Three rounded rectangles, slightly offset.
const BlueprintsIcon = () => (
  <svg {...iconProps}>
    <rect x="3" y="3" width="10" height="3" rx="0.5" />
    <rect x="3" y="7" width="10" height="3" rx="0.5" />
    <rect x="3" y="11" width="10" height="3" rx="0.5" />
  </svg>
);

const LaunchIcon = () => (
  <svg {...iconProps}>
    <path d="M3 12.5h10" />
    <path d="M8 3v7" />
    <path d="M5.5 7.5 8 10l2.5-2.5" />
  </svg>
);

// AEQI Ownership primitives — Lucide picks anchored to each row's semantic.
// Assets (a) → Coins: stacked-coin = stored value.
// Equity (e) → PieChart: cap-table slice.
// Quorum (q) → Vote: ballot-into-box = decision/governance.
// Incorporation (i) → ScrollText: founding document / charter.
const AssetsIcon = () => <Coins />;
const EquityIcon = () => <PieChart />;
const QuorumIcon = () => <Vote />;
const IncorporationIcon = () => <ScrollText />;
// Roles — its own peer slot under Trust, outside both AEQI groups. The
// org-chart authority graph (RoleNewPage / RoleDetailPage et al). Workflow
// reads parent + child boxes = hierarchy.
const RolesIcon = () => <Workflow />;

// Admin — shield silhouette.
const AdminIcon = () => (
  <svg {...iconProps}>
    <path d="M8 1.5L13 4v4.5c0 3.2-2.2 5.4-5 6-2.8-.6-5-2.8-5-6V4l5-2.5z" />
  </svg>
);

const SearchIcon = () => (
  <svg {...iconProps}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10 10l3.5 3.5" />
  </svg>
);

const PlusIcon = () => (
  <svg {...iconProps} width={12} height={12}>
    <path d="M8 3v10M3 8h10" />
  </svg>
);

const PanelGlyph = () => (
  <svg {...iconProps}>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M6.5 3v10" />
  </svg>
);

export default function LeftSidebar({ trustId, path }: LeftSidebarProps) {
  const navigate = useNavigate();
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const isMac =
    typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test(navigator.userAgent);

  const openPalette = () => window.dispatchEvent(new CustomEvent("aeqi:open-palette"));

  // Per-row right-cap action. Always visible at the right edge of its
  // nav row, mirroring the bottom Account+Help row's HelpMenu cap.
  const rowAction = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    keyHint?: string,
  ) => (
    <Tooltip content={keyHint ? `${label} (${keyHint})` : label}>
      <IconButton
        className="sidebar-row-action-btn"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClick();
        }}
        aria-label={label}
      >
        {icon}
      </IconButton>
    </Tooltip>
  );

  // Derive canonical base path for sidebar tabs.
  const entities = useDaemonStore((s) => s.entities);
  const activeEntityObj = trustId ? (entities.find((e) => e.id === trustId) ?? null) : null;
  const base = activeEntityObj ? entityBasePath(activeEntityObj) : "";
  const hasCompany = !!trustId;

  const navHref = (id: string) => `${base}/${id}`;

  // The Organization cockpit row stays lit ONLY at the bare trust URL —
  // Phase 1 promotes Treasury / Ownership / Governance / Roles to
  // top-level rows, so they own their own "active" state and shouldn't
  // double-light Organization.
  const isActiveTab = (id: string) => {
    if (!base) return false;
    return path === `${base}/${id}` || path.startsWith(`${base}/${id}/`);
  };
  const isCompanyOverview = !!base && path === base;

  // Top-level public rows.
  const isLaunch = path === "/launch" || path.startsWith("/launch/");
  const isBlueprints = path === "/blueprints" || path.startsWith("/blueprints/");
  const isAdmin = path === "/admin" || path.startsWith("/admin/");
  const isAdminUser = useAuthStore((s) => s.user?.is_admin === true);

  const navItem = (
    id: string,
    label: string,
    icon: React.ReactNode,
    opts: { soon?: boolean; action?: React.ReactNode } = {},
  ) => {
    if (opts.soon) {
      return (
        <div key={id} className="sidebar-nav-row">
          <button
            type="button"
            className="sidebar-nav-item sidebar-nav-item--soon"
            disabled
            title={`${label} — coming soon`}
          >
            {icon}
            <span className="sidebar-nav-label">{label}</span>
          </button>
        </div>
      );
    }
    const active = isActiveTab(id);
    return (
      <div key={id} className="sidebar-nav-row">
        <a
          className={`sidebar-nav-item ${active ? "active" : ""}`}
          href={navHref(id)}
          title={label}
          aria-current={active ? "page" : undefined}
          onClick={(e) => {
            e.preventDefault();
            navigate(navHref(id));
          }}
        >
          {icon}
          <span className="sidebar-nav-label">{label}</span>
        </a>
        {opts.action}
      </div>
    );
  };

  // Top-level (non-entity-scoped) row helper. Used for Launch /
  // Blueprints / Account — paths that don't compose off `base`.
  // Mirrors `navItem` but takes an explicit href.
  const topLevelItem = (
    href: string,
    label: string,
    icon: React.ReactNode,
    active: boolean,
    opts: { action?: React.ReactNode } = {},
  ) => (
    <div key={href} className="sidebar-nav-row">
      <a
        className={`sidebar-nav-item ${active ? "active" : ""}`}
        href={href}
        title={label}
        aria-current={active ? "page" : undefined}
        onClick={(e) => {
          e.preventDefault();
          navigate(href);
        }}
      >
        {icon}
        <span className="sidebar-nav-label">{label}</span>
      </a>
      {opts.action}
    </div>
  );

  return (
    <div
      className={`left-sidebar${sidebarCollapsed ? " collapsed" : ""}`}
      style={sidebarCollapsed ? undefined : { width: `${sidebarWidth}px` }}
    >
      {/* ── Brand header ── */}
      <div className="sidebar-header">
        {!sidebarCollapsed ? (
          <>
            <Link to="/" className="sidebar-brand" aria-label="aeqi — home">
              <Wordmark size={20} />
            </Link>
            <Tooltip content={`Collapse sidebar (${isMac ? "⌘" : "Ctrl"}B)`}>
              <IconButton
                className="sidebar-collapse-btn"
                onClick={toggleSidebar}
                aria-label="Collapse sidebar"
              >
                <PanelGlyph />
              </IconButton>
            </Tooltip>
          </>
        ) : (
          <Tooltip content={`Expand sidebar (${isMac ? "⌘" : "Ctrl"}B)`}>
            <button
              type="button"
              className="sidebar-nav-item sidebar-brand-collapsed"
              onClick={toggleSidebar}
              aria-label="Expand sidebar"
            >
              <span className="sidebar-brand-collapsed-rest" aria-hidden="true">
                <span
                  style={{
                    fontFamily: "var(--font-brand)",
                    fontSize: 18,
                    fontWeight: 400,
                    letterSpacing: "-0.02em",
                    color: "var(--color-accent)",
                    lineHeight: 1,
                  }}
                >
                  æ
                </span>
              </span>
              <span className="sidebar-brand-collapsed-hover" aria-hidden="true">
                <PanelGlyph />
              </span>
            </button>
          </Tooltip>
        )}
      </div>

      <div className="left-sidebar-body">
        {/* ── Top zone — Inbox is the daily-action surface; Search caps
            the row so command discovery stays structural. Only renders
            once the user has a company (Inbox is entity-scoped). Without
            a company, the bottom-group Launch row is the entry point. ── */}
        {hasCompany && (
          <nav className="sidebar-surface-nav sidebar-zone" aria-label="Inbox">
            {navItem("inbox", "Inbox", <InboxIcon />, {
              action: rowAction("Search", <SearchIcon />, openPalette, `${isMac ? "⌘" : "Ctrl"}K`),
            })}
          </nav>
        )}

        {/* ── Workspace switcher — pivots between launch/user scope and
            the active company below. ── */}
        <div className="sidebar-user-zone">
          <CompanySwitcher />
        </div>

        {/* ── Company-scope items. Visible only when a company is
            selected. Order matches the Phase-1 lock:
              TRUST (cockpit / overview — Health folded in)
              Inbox
              ORGANIZATION  (Roles · Ownership · Treasury · Governance · Channels)
              WORKSPACE     (Agents · Events · Quests · Ideas)
              Settings (standalone, gap above) ── */}
        {hasCompany && (
          <>
            <nav className="sidebar-surface-nav sidebar-zone" aria-label="TRUST">
              <div key="overview" className="sidebar-nav-row">
                <a
                  className={`sidebar-nav-item ${isCompanyOverview ? "active" : ""}`}
                  href={base}
                  title="TRUST"
                  aria-current={isCompanyOverview ? "page" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(base);
                  }}
                >
                  <TrustIcon />
                  <span className="sidebar-nav-label">TRUST</span>
                </a>
              </div>
              {/* Roles — peer slot under Trust, outside both AEQI groups. The
                  authority graph is the connective tissue between Ownership
                  (board tier) and Execution (operating tier), so it doesn't
                  belong inside either. */}
              {navItem("roles", "Roles", <RolesIcon />)}
            </nav>

            {/* AEQI ownership grammar — assets · equity · quorum · incorporation.
                The four rows spell the wordmark in order. Section label
                reinforces "this is who owns / runs the TRUST". */}
            <nav className="sidebar-surface-nav sidebar-zone" aria-label="Ownership">
              <div className="sidebar-section-label">Ownership</div>
              {navItem("assets", "Assets", <AssetsIcon />)}
              {navItem("equity", "Equity", <EquityIcon />)}
              {navItem("quorum", "Quorum", <QuorumIcon />)}
              {navItem("incorporation", "Incorporation", <IncorporationIcon />)}
            </nav>

            <nav className="sidebar-surface-nav sidebar-zone" aria-label="Execution">
              <div className="sidebar-section-label">Execution</div>
              {navItem("agents", "Agents", <AgentsIcon />)}
              {navItem("events", "Events", <EventsIcon />, {
                action: rowAction("New event", <PlusIcon />, () => {
                  navigate(`${base}/events?compose=1`);
                }),
              })}
              {navItem("quests", "Quests", <QuestsIcon />, {
                action: rowAction("New quest", <PlusIcon />, () => {
                  navigate(`${base}/quests/new`);
                }),
              })}
              {navItem("ideas", "Ideas", <IdeasIcon />, {
                action: rowAction("New idea", <PlusIcon />, () => {
                  navigate(`${base}/ideas?compose=1`);
                }),
              })}
            </nav>
          </>
        )}

        {/* ── Bottom group — Blueprints + (admin) + AccountDropdown.
            Account isn't a nav row anymore: the AccountDropdown trigger
            below opens a menu that routes to /account on click, and a
            duplicate row is redundant. Blueprints = the catalog
            (top-level, public). ── */}
        <div className="sidebar-bottom-group">
          <nav className="sidebar-surface-nav" aria-label="Platform">
            {topLevelItem("/launch", "Launch", <LaunchIcon />, isLaunch)}
            {topLevelItem("/blueprints", "Blueprints", <BlueprintsIcon />, isBlueprints)}
            {isAdminUser && topLevelItem("/admin", "Admin", <AdminIcon />, isAdmin)}
          </nav>
          <div className="sidebar-action-row sidebar-action-row--account">
            <AccountDropdown />
            <HelpMenu />
          </div>
        </div>
      </div>

      {!sidebarCollapsed && (
        <div
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onMouseDown={(e) => {
            e.preventDefault();
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";

            const startX = e.clientX;
            const startWidth = sidebarWidth;

            const onMove = (ev: MouseEvent) => {
              setSidebarWidth(startWidth + (ev.clientX - startX));
            };
            const onUp = () => {
              document.body.style.cursor = "";
              document.body.style.userSelect = "";
              window.removeEventListener("mousemove", onMove);
              window.removeEventListener("mouseup", onUp);
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
          }}
        />
      )}
    </div>
  );
}
