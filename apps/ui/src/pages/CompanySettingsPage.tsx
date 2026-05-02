import PlanTab from "@/pages/Agent/PlanTab";

interface CompanySettingsPageProps {
  /** The Company's root-agent id (also the entity id). PlanTab resolves
   *  the per-Company subscription from this. */
  agentId: string;
}

/**
 * `/c/:entityId/settings` — Company Settings tab. Plan is per-Company
 * billing and lives here (not on the agent rail). Other Company-scoped
 * config (name, logo, default model, integrations, danger zone) will
 * land here as separate sections.
 */
export default function CompanySettingsPage({ agentId }: CompanySettingsPageProps) {
  return <PlanTab agentId={agentId} />;
}
