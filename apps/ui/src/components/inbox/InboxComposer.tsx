import { useEffect, useRef, useState } from "react";
import { Button, Tooltip } from "../ui";
import { probeDismissEndpoint } from "@/store/inbox";

export interface InboxComposerProps {
  sessionId: string;
  onSend: (sessionId: string, body: string) => Promise<{ ok: boolean; error?: string }>;
  onDismiss: (sessionId: string) => Promise<{ ok: boolean; error?: string }>;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
}

// Archive icon — box with tray + horizontal bar inside
function ArchiveIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 13 13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="1" y="2" width="11" height="2.5" rx="0.5" />
      <path d="M2 4.5v5.5a1 1 0 001 1h7a1 1 0 001-1V4.5" />
      <path d="M4.5 7.5h4" />
    </svg>
  );
}

export default function InboxComposer({
  sessionId,
  onSend,
  onDismiss,
  composerRef,
}: InboxComposerProps) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null = probing, true = available, false = not yet deployed
  const [dismissAvailable, setDismissAvailable] = useState<boolean | null>(null);

  // Probe dismiss endpoint availability once, not per-session
  const probeRef = useRef(false);
  useEffect(() => {
    if (probeRef.current) return;
    probeRef.current = true;
    void probeDismissEndpoint().then(setDismissAvailable);
  }, []);

  // Reset state when the selected session changes
  useEffect(() => {
    setBody("");
    setError(null);
    setSending(false);
    setDismissing(false);
  }, [sessionId]);

  const send = async () => {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    const result = await onSend(sessionId, trimmed);
    setSending(false);
    if (result.ok) {
      setBody("");
    } else {
      setError(result.error ?? "Failed to send.");
    }
  };

  const dismiss = async () => {
    if (dismissing || dismissAvailable === false) return;
    setDismissing(true);
    setError(null);
    const result = await onDismiss(sessionId);
    setDismissing(false);
    if (!result.ok) {
      setError(result.error ?? "Failed to archive.");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="inbox-composer">
      {error && (
        <div className="inbox-composer-error" role="alert">
          {error}
        </div>
      )}
      <div className="inbox-composer-inner">
        <textarea
          ref={composerRef}
          className="inbox-composer-textarea"
          placeholder="Reply…"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending}
          aria-label="Reply"
        />
        <div className="inbox-composer-footer">
          <span className="inbox-composer-hint" aria-hidden>
            ⌘↵ to send
          </span>
          <div className="inbox-composer-actions">
            <Tooltip content={dismissAvailable === false ? "Coming soon" : "Archive"}>
              <button
                type="button"
                className="sidebar-row-action-btn inbox-archive-btn"
                onClick={() => void dismiss()}
                disabled={dismissing || dismissAvailable === false || dismissAvailable === null}
                aria-label={dismissAvailable === false ? "Archive (coming soon)" : "Archive"}
              >
                <ArchiveIcon />
              </button>
            </Tooltip>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void send()}
              disabled={!body.trim() || sending}
            >
              {sending ? "Sending" : "Send"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
