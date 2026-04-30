import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useDaemonStore } from "@/store/daemon";
import { useInboxStore } from "@/store/inbox";
import { api } from "@/lib/api";

/**
 * Bounces the legacy flat `/sessions/:sessionId` URL onto the canonical
 * deep shape `/c/<entity>/agents/<agent>/sessions/<sessionId>`. Resolves
 * the owning agent (inbox store first; then `getSessions` for stale or
 * already-answered sessions) and the agent's entity from the daemon
 * store. Bounces home when the session can't be resolved.
 */
export default function SessionRedirect() {
  const { sessionId = "" } = useParams<{ sessionId: string }>();
  const inboxItem = useInboxStore((s) => s.items.find((i) => i.session_id === sessionId) ?? null);
  const agents = useDaemonStore((s) => s.agents);

  const [resolvedAgentId, setResolvedAgentId] = useState<string | null>(
    inboxItem?.agent_id ?? null,
  );
  const [resolveFailed, setResolveFailed] = useState(false);

  useEffect(() => {
    if (inboxItem?.agent_id) setResolvedAgentId(inboxItem.agent_id);
  }, [inboxItem?.agent_id]);

  useEffect(() => {
    if (resolvedAgentId) return;
    if (inboxItem?.agent_id) return;
    if (!sessionId) {
      setResolveFailed(true);
      return;
    }
    let cancelled = false;
    api
      .getSessions()
      .then((data) => {
        if (cancelled) return;
        const sessions = (data?.sessions || []) as Array<Record<string, unknown>>;
        const match = sessions.find((s) => (s.id as string) === sessionId);
        const aid = match?.agent_id as string | undefined;
        if (aid) setResolvedAgentId(aid);
        else setResolveFailed(true);
      })
      .catch(() => {
        if (!cancelled) setResolveFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, inboxItem?.agent_id, resolvedAgentId]);

  if (resolveFailed) return <Navigate to="/" replace />;
  if (!resolvedAgentId) return null;

  const agent = agents.find((a) => a.id === resolvedAgentId);
  const entityId = agent?.entity_id ?? inboxItem?.entity_id ?? null;
  if (!entityId) return null;

  const deep = `/c/${encodeURIComponent(entityId)}/agents/${encodeURIComponent(resolvedAgentId)}/sessions/${encodeURIComponent(sessionId)}`;
  return <Navigate to={deep} replace />;
}
