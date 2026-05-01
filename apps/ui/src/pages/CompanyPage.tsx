import { useEffect } from "react";
import AgentPage from "@/components/AgentPage";
import PageRail from "@/components/PageRail";
import OwnershipPage from "@/pages/OwnershipPage";
import TreasuryPage from "@/pages/TreasuryPage";
import TransactionsPage from "@/pages/TransactionsPage";
import GovernancePage from "@/pages/GovernancePage";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "roles", label: "Roles" },
  { id: "ownership", label: "Ownership" },
  { id: "treasury", label: "Treasury" },
  { id: "transactions", label: "Transactions" },
  { id: "governance", label: "Governance" },
];

const TAB_TITLES: Record<string, string> = {
  overview: "overview",
  roles: "roles",
  ownership: "ownership",
  treasury: "treasury",
  transactions: "transactions",
  governance: "governance",
};

interface CompanyPageProps {
  agentId: string;
  entityId: string;
  /** Resolved tab — defaulted to "overview" upstream. The bare
   *  `/c/<entity>` URL renders Overview through this tab default. */
  tab: string;
  itemId?: string;
}

/**
 * `/c/:entityId/{overview,roles,ownership,treasury,transactions,governance}`
 * — the company cockpit. The PageRail is the company's secondary nav,
 * sitting below the global LeftSidebar's company section (which owns the
 * four primitives + Overview). Overview / Roles delegate to AgentPage;
 * Ownership / Treasury / Transactions / Governance are dedicated
 * company-entity views (cap table, balance state, financial flow,
 * proposals) so they render their own pages inside the same rail.
 */
export default function CompanyPage({ agentId, entityId, tab, itemId }: CompanyPageProps) {
  useEffect(() => {
    const section = TAB_TITLES[tab] ?? "company";
    document.title = `${section} · æqi`;
  }, [tab]);

  return (
    <div className="page-rail-shell">
      <PageRail
        tabs={TABS}
        defaultTab="overview"
        title="Company"
        basePath={`/c/${encodeURIComponent(entityId)}`}
        currentValue={tab}
      />
      <div className="page-rail-content page-rail-content--full">
        {tab === "ownership" ? (
          <OwnershipPage />
        ) : tab === "treasury" ? (
          <TreasuryPage />
        ) : tab === "transactions" ? (
          <TransactionsPage />
        ) : tab === "governance" ? (
          <GovernancePage />
        ) : (
          <AgentPage agentId={agentId} tab={tab} itemId={itemId} />
        )}
      </div>
    </div>
  );
}
