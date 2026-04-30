import { useState, useEffect } from "react";
import { useInboxStore } from "@/store/inbox";
import BlockAvatar from "@/components/BlockAvatar";

interface AwaitingBannerProps {
  sessionId: string | null;
  agentName: string;
}

/**
 * Pinned context banner above the chat — "answering [agent_name]" plus
 * the awaiting subject — when the displayed session has an unanswered
 * `question.ask` from the agent. Hidden otherwise.
 *
 * The user replies and the daemon clears `awaiting_at`, the inbox row
 * disappears, but we keep the last good snapshot rendered until the
 * session changes — otherwise the header pops away mid-conversation
 * the moment the first user message lands.
 */
export default function AwaitingBanner({ sessionId, agentName }: AwaitingBannerProps) {
  const inboxItem = useInboxStore((s) =>
    sessionId ? (s.items.find((i) => i.session_id === sessionId) ?? null) : null,
  );
  const [snapshot, setSnapshot] = useState(inboxItem);

  useEffect(() => {
    if (inboxItem) setSnapshot(inboxItem);
  }, [inboxItem]);

  // Reset when the session changes — don't carry one session's banner
  // into another.
  useEffect(() => {
    setSnapshot(inboxItem ?? null);
    // Intentionally only re-run on sessionId; inboxItem is the live
    // store read which we don't want as a dependency here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const item = inboxItem ?? snapshot;
  if (!item) return null;

  return (
    <header className="asv-awaiting-banner" aria-label="Awaiting reply context">
      <span className="asv-awaiting-banner-avatar" aria-hidden="true">
        <BlockAvatar name={item.agent_name || agentName} size={20} />
      </span>
      <h2 className="asv-awaiting-banner-title">answering {item.agent_name || agentName}</h2>
      {item.awaiting_subject && (
        <p className="asv-awaiting-banner-subject">{item.awaiting_subject}</p>
      )}
    </header>
  );
}
