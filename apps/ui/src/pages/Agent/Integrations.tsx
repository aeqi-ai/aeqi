import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiRequest } from "@/api/client";
import { IntegrationsPanel } from "@/components/IntegrationsPanel";
import { Banner, Button, Spinner } from "@/components/ui";

interface AgentIntegrationsTabProps {
  agentId: string;
}

interface GoogleStatus {
  connected: boolean;
  scopes?: string[];
  expires_at?: string | null;
  account_email?: string | null;
}

interface GoogleStartResponse {
  authorize_url?: string;
  error?: string;
  setup_required?: boolean;
}

/**
 * Per-agent Google connect surface (Path B). Hits the platform-side flow:
 *   GET /api/agents/{id}/integrations/google/start  → authorize URL
 *   GET /api/agents/{id}/integrations/google/status → connection state
 * Tokens land in the per-tenant runtime's credentials substrate at
 * (Agent, agent_id, google, oauth_token), exactly where the
 * pack:google-workspace tools read them.
 */
function GoogleConnectCard({ agentId }: { agentId: string }) {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiRequest<GoogleStatus>(
        `/api/agents/${encodeURIComponent(agentId)}/integrations/google/status`,
      );
      setStatus(data);
      setError(null);
    } catch (e: unknown) {
      // 503 / setup-required falls back to "not connected" — same UX.
      setStatus({ connected: false });
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Post-callback: ?connected=google → invalidate + clear the param.
  useEffect(() => {
    if (searchParams.get("connected") === "google") {
      const next = new URLSearchParams(searchParams);
      next.delete("connected");
      setSearchParams(next, { replace: true });
      refresh();
    }
  }, [searchParams, setSearchParams, refresh]);

  const handleConnect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await apiRequest<GoogleStartResponse>(
        `/api/agents/${encodeURIComponent(agentId)}/integrations/google/start`,
      );
      if (data.authorize_url) {
        // Full-page redirect — matches the existing /api/auth/google
        // (user sign-in) pattern. No popup.
        window.location.href = data.authorize_url;
      } else {
        setError(
          data.setup_required
            ? "Google OAuth isn't configured on this deployment yet. Ask the operator to set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET."
            : (data.error ?? "Couldn't start Google connect flow."),
        );
        setBusy(false);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Connect failed.";
      const setup = msg.toLowerCase().includes("not_configured") || msg.includes("503");
      setError(setup ? "Google OAuth isn't configured on this deployment yet." : msg);
      setBusy(false);
    }
  }, [agentId]);

  if (loading && status === null) {
    return (
      <div style={{ padding: "var(--space-4)" }}>
        <Spinner />
      </div>
    );
  }

  if (status?.connected) {
    const scopeBlurb = (() => {
      const scopes = status.scopes ?? [];
      const hasGmail = scopes.some((s) => s.includes("gmail"));
      const hasCalendar = scopes.some((s) => s.includes("calendar"));
      const parts: string[] = [];
      if (hasGmail) parts.push("Gmail");
      if (hasCalendar) parts.push("Calendar");
      return parts.length > 0 ? parts.join(" + ") : "Workspace";
    })();
    return (
      <Banner kind="success">
        Google {scopeBlurb} connected
        {status.account_email ? ` as ${status.account_email}` : ""}.
      </Banner>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
        padding: "var(--space-4)",
        background: "var(--color-card)",
        borderRadius: "var(--radius-md)",
      }}
    >
      <div>
        <h3
          style={{
            margin: 0,
            fontSize: "var(--font-size-base)",
            fontWeight: 600,
          }}
        >
          Google Workspace
        </h3>
        <p
          style={{
            margin: "var(--space-1) 0 0",
            color: "var(--color-text-muted)",
            fontSize: "var(--font-size-sm)",
            lineHeight: 1.5,
          }}
        >
          Gmail, Calendar, and Meet. Connecting opens Google&apos;s consent screen; the agent gets
          its own Google session, separate from yours.
        </p>
      </div>
      {error && <Banner kind="error">{error}</Banner>}
      <div>
        <Button variant="primary" onClick={handleConnect} disabled={busy}>
          {busy ? "Opening Google…" : "Connect Google"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Per-agent Integrations tab. Each agent has its own credential rows so a
 * Luca-style WhatsApp agent gets its own Gmail / GitHub / etc., separate
 * from the operator's personal credentials.
 */
export default function AgentIntegrationsTab({ agentId }: AgentIntegrationsTabProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-6)",
      }}
    >
      <GoogleConnectCard agentId={agentId} />
      <IntegrationsPanel
        scope={{ scope_kind: "agent", scope_id: agentId }}
        heading="Integrations"
        description="These credentials belong to this agent only. Other agents — including this one's parent and children — have their own connections."
      />
    </div>
  );
}
