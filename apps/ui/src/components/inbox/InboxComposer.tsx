import { useEffect, useState } from "react";
import { Button } from "../ui";

export interface InboxComposerProps {
  sessionId: string;
  onSend: (sessionId: string, body: string) => Promise<{ ok: boolean; error?: string }>;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
}

export default function InboxComposer({ sessionId, onSend, composerRef }: InboxComposerProps) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when the selected session changes
  useEffect(() => {
    setBody("");
    setError(null);
    setSending(false);
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
  );
}
