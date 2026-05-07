import { useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useChatStore } from "@/store/chat";
import { useInboxStore } from "@/store/inbox";
import { sessionLabel, type SessionInfo } from "@/components/session/types";
import { recencyBucket, timeShort } from "@/lib/format";
import { sessionDeepUrl } from "@/lib/sessionUrl";
import SessionRail, { type SessionRailRow } from "@/components/sessions/SessionRail";

const NO_SESSIONS: SessionInfo[] = [];

/**
 * Sessions rail — the left-adjacent index column for the drilled-agent
 * chat surface. Adapts the chat-store sessions list into the canonical
 * `SessionRailRow` shape, then defers to the universal `<SessionRail>`
 * primitive at `components/sessions/SessionRail.tsx`. Awaiting rows are
 * flagged via the inbox store. The user-scope inbox lives at `/me/inbox`
 * (MeInboxPage) — that surface adopts the same primitive directly.
 *
 * Row shape is single-line h=32 across both adopters — the agent surface
 * and the inbox render visually identical rails. Origin (telegram /
 * whatsapp / web) was previously surfaced as a wrapped second line on
 * agent-side rows; that information now lives on the session detail
 * header where it doesn't compete with the row primary.
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

  const rows = useMemo<SessionRailRow[]>(() => {
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

  const navigate = useNavigate();
  const handleSelect = useCallback(
    (id: string) => {
      if (!entityId || !agentId) return;
      navigate(sessionDeepUrl(entityId, agentId, id), { replace: true });
    },
    [entityId, agentId, navigate],
  );

  return (
    <SessionRail
      rows={rows}
      selectedId={itemId ?? null}
      onSelect={handleSelect}
      streamingIds={streamingSessions}
      emptyTitle="no sessions yet"
      emptyHint="type below to start one"
    />
  );
}
