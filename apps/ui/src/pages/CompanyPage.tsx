import { useEffect } from "react";
import AgentPage from "@/components/AgentPage";
import PageRail from "@/components/PageRail";
import CapTablePage from "@/pages/CapTablePage";
import TreasuryPage from "@/pages/TreasuryPage";
import BudgetsPage from "@/pages/BudgetsPage";
import TransactionsPage from "@/pages/TransactionsPage";
import GovernancePage from "@/pages/GovernancePage";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "roles", label: "Roles" },
  { id: "cap-table", label: "Cap Table" },
  { id: "treasury", label: "Treasury" },
  { id: "budgets", label: "Budgets" },
  { id: "transactions", label: "Transactions" },
  { id: "governance", label: "Governance" },
];

const TAB_TITLES: Record<string, string> = {
  overview: "overview",
  roles: "roles",
  "cap-table": "cap table",
  treasury: "treasury",
  budgets: "budgets",
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
 * `/c/:entityId/{overview,roles,cap-table,treasury,budgets,transactions,governance}`
 * — the company cockpit. The PageRail is the company's secondary nav,
 * sitting below the global LeftSidebar's company section (which owns the
 * four primitives + Overview). Overview / Roles delegate to AgentPage;
 * Cap Table / Treasury / Budgets / Transactions / Governance are
 * dedicated company-entity views (equity, balance state, planned spend,
 * financial flow, proposals) so they render their own pages inside the
 * same rail.
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
        {tab === "cap-table" ? (
          <CapTablePage />
        ) : tab === "treasury" ? (
          <TreasuryPage />
        ) : tab === "budgets" ? (
          <BudgetsPage />
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
