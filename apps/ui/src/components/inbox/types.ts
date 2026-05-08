/**
 * Client-side model for inbox — maps the wire `InboxItem` to a richer
 * shape forward-compatible with the unified Session primitive. The
 * inbox endpoint returns every session in scope, not only awaiting
 * decision-requests; `awaiting` carries the "pending decision" bit
 * (rail dot, list copy) but never gates replies — the user can type
 * into any session they own.
 */
import type { InboxItem } from "@/lib/api";

export type InboxKind = "decision_request" | "system";
export type InboxSort = "recent" | "unread";
export type InboxGroup = "Today" | "Yesterday" | "This week" | "Earlier";

export interface InboxRow {
  id: string; // session_id
  kind: InboxKind;
  from: { kind: "agent"; id: string; name: string };
  subject: string; // awaiting_subject, last_agent_message, or session_name
  entity_id: string | null;
  agent_id: string | null;
  created_at: string; // last_active — recency anchor for sort/grouping
  unread: boolean;
  awaiting: boolean; // pending decision-request — drives the rail's pending indicator
}

export interface InboxFilterState {
  entityId: string | null; // "all" = null
  kind: InboxKind | "all";
  unreadOnly: boolean;
}

export const DEFAULT_FILTER: InboxFilterState = {
  entityId: null,
  kind: "all",
  unreadOnly: false,
};

/** Map a raw InboxItem to the client InboxRow model. */
export function toInboxRow(item: InboxItem): InboxRow {
  const awaiting = !!item.awaiting_at;
  return {
    id: item.session_id,
    kind: awaiting ? "decision_request" : "system",
    from: {
      kind: "agent",
      id: item.agent_id ?? item.session_id,
      name: item.agent_name ?? "Agent",
    },
    subject: item.awaiting_subject ?? item.last_agent_message ?? item.session_name,
    entity_id: item.entity_id ?? null,
    agent_id: item.agent_id ?? null,
    created_at: item.last_active,
    unread: awaiting,
    awaiting,
  };
}

// ── Time-grouping ────────────────────────────────────────────────────────────

const MS_DAY = 86_400_000;

export function groupOf(isoDate: string): InboxGroup {
  const now = Date.now();
  const ts = Date.parse(isoDate);
  if (Number.isNaN(ts)) return "Earlier";

  const todayStart = startOfDay(now);
  const yesterdayStart = todayStart - MS_DAY;
  const weekStart = todayStart - 6 * MS_DAY;

  if (ts >= todayStart) return "Today";
  if (ts >= yesterdayStart) return "Yesterday";
  if (ts >= weekStart) return "This week";
  return "Earlier";
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export const GROUP_ORDER: InboxGroup[] = ["Today", "Yesterday", "This week", "Earlier"];

/** Relative time label: "2m ago", "3h ago", "Apr 28" */
export function relativeTime(isoDate: string): string {
  const now = Date.now();
  const ts = Date.parse(isoDate);
  if (Number.isNaN(ts)) return "";
  const diff = now - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Two-letter initials from a name. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}
