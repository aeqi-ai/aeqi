import { EmptyState } from "@/components/ui/EmptyState";

export default function BudgetsPage() {
  return (
    <div className="asv-main">
      <EmptyState
        title="Budgets"
        description="Coming soon. Spend limits and allocations across agents, departments, and quests — the planned half of the financial picture."
      />
    </div>
  );
}
