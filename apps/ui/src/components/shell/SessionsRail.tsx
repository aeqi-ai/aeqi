import { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useChatStore } from "@/store/chat";
import { useInboxStore } from "@/store/inbox";
import { sessionLabel, type SessionInfo } from "@/components/session/types";
import { recencyBucket, timeShort } from "@/lib/format";
import { sessionDeepUrl } from "@/lib/sessionUrl";
import SessionRail, { type SessionRailRow } from "@/components/sessions/SessionRail";
import SessionsToolbar from "@/components/sessions/SessionsToolbar";

const NO_SESSIONS: SessionInfo[] = [];

/**
 * Sessions rail — the left-adjacent index column for the drilled-agent
 * chat surface. Renders the canonical `<SessionsToolbar>` (search +
 * sort/filter slots) above the universal `<SessionRail>` primitive.
 * Adapts the chat-store sessions list into `SessionRailRow`s; awaiting
 * rows are flagged via the inbox store. The user-scope inbox lives at
 * `/me/inbox` (MeInboxPage) and mounts the same primitive pair.
 *
 * Sort / filter slots are intentionally empty here — agent-rail
 * sessions sort by recency only, no decision-vs-system kind split, no
 * cross-entity filter. The shared toolbar shell still gives both
 * surfaces one search field at the top of the rail; matching is
 * client-side substring against `primary` and `secondary`.
 *
 * Row shape is single-line h=32 across both adopters — visual parity
 * with the inbox.
 */
export default function SessionsRail() {
  // Mounted only under `/c/<entity>/agents/<agent>/sessions[/...]` per
  // AppLayout's `showSessionsRail` gate, so both params are populated.
  const { entityId, agentId, itemId } = useParams<{
    entityId?: string;
    agentId?: string;
    itemId?: string;
  }>();

  const sessions = useChatStore((s) =>
    agentId ? s.sessionsByAgent[agentId] || NO_SESSIONS : NO_SESSIONS,
  );
  const streamingSessions = useChatStore((s) => s.streamingSessions);
  const inboxItems = useInboxStore((s) => s.items);
  const awaitingSessionIds = useMemo(
    () => new Set(inboxItems.map((i) => i.session_id)),
    [inboxItems],
  );

  const [query, setQuery] = useState("");

  const allRows = useMemo<SessionRailRow[]>(() => {
    return sessions
      .filter((s) => s.session_type !== "task")
      .map((s) => {
        const tsRaw = s.last_active || s.created_at;
        const ts = tsRaw ? new Date(tsRaw).getTime() : 0;
        return {
          id: s.id,
          primary: sessionLabel(s),
          time: timeShort(tsRaw ?? null),
          status: s.status,
          awaiting: awaitingSessionIds.has(s.id),
          group: recencyBucket(tsRaw ?? null),
          sortKey: ts,
        };
      })
      .sort((a, b) => b.sortKey - a.sortKey);
  }, [sessions, awaitingSessionIds]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allRows;
    return allRows.filter((r) => r.primary.toLowerCase().includes(q));
  }, [allRows, query]);

  const navigate = useNavigate();
  const handleSelect = useCallback(
    (id: string) => {
      if (!entityId || !agentId) return;
      navigate(sessionDeepUrl(entityId, agentId, id), { replace: true });
    },
    [entityId, agentId, navigate],
  );

  // Empty-state copy distinguishes "no sessions yet" from "no matches"
  // so the surface speaks accurately in both shapes.
  const isFilteringEmpty = allRows.length > 0 && rows.length === 0;
  const emptyTitle = isFilteringEmpty ? "no matches" : "inbox is clear";
  const emptyHint = isFilteringEmpty ? "try a different search term." : "type below to start one";

  return (
    <>
      <SessionsToolbar query={query} onQuery={setQuery} searchPlaceholder="Search sessions" />
      <SessionRail
        rows={rows}
        selectedId={itemId ?? null}
        onSelect={handleSelect}
        streamingIds={streamingSessions}
        emptyTitle={emptyTitle}
        emptyHint={emptyHint}
      />
    </>
  );
}
