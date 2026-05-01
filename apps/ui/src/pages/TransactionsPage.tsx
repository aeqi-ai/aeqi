import { EmptyState } from "@/components/ui/EmptyState";

export default function TransactionsPage() {
  return (
    <div className="asv-main">
      <EmptyState
        title="Transactions"
        description="Coming soon. The company's financial flow — every transfer, fee, payout, and reconciliation."
      />
    </div>
  );
}
