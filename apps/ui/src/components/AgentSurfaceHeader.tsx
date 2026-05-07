import { Link, useNavigate } from "react-router-dom";
import { useNav } from "@/hooks/useNav";
import { useDaemonStore } from "@/store/daemon";
import { Button, Tooltip } from "@/components/ui";
import AgentAvatar from "./AgentAvatar";

/**
 * Header for the drilled-agent default surface. Mirrors the idea-detail
 * shape: back link to the parent list on the left, the agent's name +
 * avatar in the middle, primary actions on the right.
 *
 * Variants:
 *   - "default" (drilled-agent landing) → [← Agents] · <Agent name> ·
 *     [+ New session] · [Settings]
 *   - "settings" (settings sub-surface) → [← Back to <Agent>] ·
 *     <Agent name> / Settings (breadcrumb)
 *
 * The chat surface lives one level beneath the header — sessions rail
 * to the left of the chat column (mounted by AppLayout), composer at
 * the bottom of the chat column.
 */
export default function AgentSurfaceHeader({
  agentId,
  variant = "default",
}: {
  agentId: string;
  variant?: "default" | "settings";
}) {
  const navigate = useNavigate();
  const { entityPath, base } = useNav();
  const agents = useDaemonStore((s) => s.agents);
  const agent = agents.find((a) => a.id === agentId);
  const agentName = agent?.name || agentId;
  const entityId = agent?.entity_id || "";

  // Back link target. Default surface goes back to the entity's
  // Agents list; settings goes back to the agent's default (chat).
  const backHref =
    variant === "settings"
      ? `${base}/agents/${encodeURIComponent(agentId)}`
      : entityId
        ? entityPath(entityId, "agents")
        : "/";
  const backLabel = variant === "settings" ? agentName : "Agents";
  const settingsHref = `${base}/agents/${encodeURIComponent(agentId)}/settings`;

  // "+ New session" — broadcast the same custom event the type-anywhere
  // shortcut uses. AgentSessionView listens for this and resets the
  // active conversation.
  const handleNewSession = () => {
    window.dispatchEvent(new CustomEvent("aeqi:new-session"));
  };

  return (
    <div className="agent-surface-header">
      <div className="agent-surface-header-crumbs">
        <Tooltip content={`Back to ${backLabel}`}>
          <Link to={backHref} className="agent-surface-header-back">
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M10 12L6 8l4-4" />
            </svg>
            {backLabel}
          </Link>
        </Tooltip>
        <span className="agent-surface-header-sep" aria-hidden>
          /
        </span>
        <span className="agent-surface-header-agent">
          <span className="agent-surface-header-avatar" aria-hidden>
            <AgentAvatar name={agentName} />
          </span>
          <span className="agent-surface-header-name">{agentName}</span>
        </span>
        {variant === "settings" && (
          <>
            <span className="agent-surface-header-sep" aria-hidden>
              /
            </span>
            <span className="agent-surface-header-crumb">Settings</span>
          </>
        )}
      </div>
      {variant === "default" && (
        <div className="agent-surface-header-actions">
          <Tooltip content="Start a fresh conversation with this agent">
            <Button variant="secondary" size="sm" onClick={handleNewSession}>
              + New session
            </Button>
          </Tooltip>
          <Tooltip content="Agent settings — model, tools, channels">
            <Button variant="secondary" size="sm" onClick={() => navigate(settingsHref)}>
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <circle cx="8" cy="8" r="2" />
                <path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.7 3.3l-1.4 1.4M4.7 11.3l-1.4 1.4M12.7 12.7l-1.4-1.4M4.7 4.7l-1.4-1.4" />
              </svg>
              Settings
            </Button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}
