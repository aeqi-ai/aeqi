/**
 * Client-side model for inbox — maps legacy InboxItem to a richer shape
 * that's forward-compatible with the unified Session primitive.
 *
 * Backend contract stays on the existing awaiting_at/answer_inbox path.
 * This adapter layer lives 100% in the UI so no schema migrations are needed.
 */
import type { InboxItem } from "@/lib/api";

export type InboxKind = "decision_request" | "system";
export type InboxSort = "recent" | "unread";
export type InboxGroup = "Today" | "Yesterday" | "This week" | "Earlier";

export interface InboxRow {
  id: string; // session_id
  kind: InboxKind;
  from: { kind: "agent"; id: string; name: string };
  subject: string; // awaiting_subject or last_agent_message
  entity_id: string | null;
  agent_id: string | null;
  created_at: string; // awaiting_at
  unread: boolean; // always true for now — server only sends awaiting items
  replyable: boolean; // true while awaiting_at is set
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
  return {
    id: item.session_id,
    kind: "decision_request",
    from: {
      kind: "agent",
      id: item.agent_id ?? item.session_id,
      name: item.agent_name ?? "Agent",
    },
    subject: item.awaiting_subject ?? item.last_agent_message ?? item.session_name,
    entity_id: item.entity_id ?? null,
    agent_id: item.agent_id ?? null,
    created_at: item.awaiting_at,
    unread: true,
    replyable: true,
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
