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
 * Resolve a session's origin — the answer to "why does this session
 * exist?". Returns a short lowercase string when we can name it
 * confidently (telegram / whatsapp / web), or undefined for the
 * generic catchalls (`interactive`, `perpetual`) where the rail row
 * should stay single-line. Event- and agent-spawned origins would
 * need a richer backend signal; not surfaced today.
 */
function deriveOrigin(s: SessionInfo): string | undefined {
  const n = s.name?.toLowerCase() || "";
  if (n.includes("telegram")) return "telegram";
  if (n.includes("whatsapp")) return "whatsapp";
  if (s.session_type === "web") return "web";
  return undefined;
}

/**
 * Sessions rail — the left-adjacent index column for the drilled-agent
 * chat surface. Adapts the chat-store sessions list into the canonical
 * `SessionRailRow` shape, then defers to the universal `<SessionRail>`
 * primitive at `components/sessions/SessionRail.tsx`. Awaiting rows are
 * flagged via the inbox store. The user-scope inbox lives at `/me/inbox`
 * (MeInboxPage) — that surface adopts the same primitive directly.
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
        // Origin = where the session came from. Only render when
        // it's something meaningful (real transport / event hook /
        // sub-agent chain). Sessions started by typing into the
        // composer leave this empty — the session label IS the row.
        // "interactive" and "perpetual" are internal catchalls and
        // tell the user nothing, so they're omitted.
        const origin = deriveOrigin(s);
        const tsRaw = s.last_active || s.created_at;
        const ts = tsRaw ? new Date(tsRaw).getTime() : 0;
        return {
          id: s.id,
          primary: sessionLabel(s),
          secondary: origin,
          // Wrap only when there's a secondary line to balance —
          // otherwise the row stays single-line and tight.
          wrapPrimary: !!origin,
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
