import { IntegrationsPanel } from "@/components/IntegrationsPanel";

interface AgentIntegrationsTabProps {
  agentId: string;
}

/**
 * Per-agent Integrations tab. Each agent has its own credential rows so a
 * Luca-style WhatsApp agent gets its own Gmail / GitHub / etc., separate
 * from the operator's personal credentials.
 *
 * IntegrationsPanel handles the full catalog (Google + others) with per-card
 * connect / refresh / disconnect actions. The standalone GoogleConnectCard
 * was retired 2026-05-08 — it duplicated the Google entry from the catalog
 * and fired a double-prefixed `/api/api/.../google/status` 404 on first paint.
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
      <IntegrationsPanel
        scope={{ scope_kind: "agent", scope_id: agentId }}
        heading="Integrations"
        description="These credentials belong to this agent only. Other agents — including this one's parent and children — have their own connections."
      />
    </div>
  );
}
