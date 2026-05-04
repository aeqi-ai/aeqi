import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import {
  fetchTokenHolders,
  fetchTrustModules,
  findModuleByType,
  indexerEnabled,
  type IndexedModule,
  type IndexedTokenBalance,
} from "@/lib/indexer";
import { COMPANY_MONTHLY, formatCents, RESOURCE_PACK } from "@/lib/pricing";
import { useDaemonStore } from "@/store/daemon";

interface TreasuryPageProps {
  entityId: string;
}

interface CompanyBillingRow {
  name: string;
  agent_id: string | null;
  plan: "company";
  stripe_subscription_id: string | null;
  status: "active" | "trialing" | "past_due" | "canceled";
  next_charge_at: string | null;
}

const STATUS_VARIANT: Record<
  CompanyBillingRow["status"],
  "success" | "info" | "warning" | "muted"
> = {
  active: "success",
  trialing: "info",
  past_due: "warning",
  canceled: "muted",
};

const STATUS_LABEL: Record<CompanyBillingRow["status"], string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Past due",
  canceled: "Canceled",
};

/**
 * Phase 1 treasury view: subscription state for this Company surfaced
 * from Stripe via the platform's `/billing/overview` endpoint, plus the
 * resource pack the plan includes. The on-chain cap table — present
 * once the Solana bridge has indexed the entity — appears as a
 * supplementary section underneath.
 */
export default function TreasuryPage({ entityId }: TreasuryPageProps) {
  const entity = useDaemonStore((s) => s.entities.find((e) => e.id === entityId));
  const trustAddress = entity?.trust_address;

  const [billing, setBilling] = useState<CompanyBillingRow | null | undefined>(undefined);
  const [paymentLast4, setPaymentLast4] = useState<string | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBilling(undefined);
    setBillingError(null);
    (async () => {
      try {
        const overview = await api.getBillingOverview();
        if (cancelled) return;
        const row = overview.companies.find((c) => c.agent_id === entityId) ?? null;
        setBilling(row);
        setPaymentLast4(overview.payment_method_last4);
      } catch (err) {
        if (!cancelled) {
          setBillingError(err instanceof Error ? err.message : String(err));
          setBilling(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entityId]);

  const openPortal = async () => {
    setPortalBusy(true);
    try {
      const { url } = await api.openBillingPortal();
      window.location.href = url;
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : String(err));
      setPortalBusy(false);
    }
  };

  if (billing === undefined) {
    return (
      <div
        className="asv-main"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--space-xl)",
        }}
      >
        <Spinner />
      </div>
    );
  }

  return (
    <div className="asv-main" style={{ padding: "var(--space-lg)" }}>
      <header style={{ marginBottom: "var(--space-lg)" }}>
        <h2 style={{ margin: 0 }}>Treasury</h2>
        <p style={{ color: "var(--color-text-muted)", margin: "var(--space-xs) 0 0 0" }}>
          Subscription, resources, and on-chain balances for this Company.
        </p>
      </header>

      {billingError && (
        <div
          style={{
            padding: "var(--space-sm) var(--space-md)",
            background: "var(--color-card)",
            borderRadius: "var(--radius-md)",
            marginBottom: "var(--space-md)",
            color: "var(--color-text-muted)",
            fontSize: "var(--text-sm)",
          }}
        >
          Couldn't load billing: {billingError}
        </div>
      )}

      {!billing && !billingError && (
        <EmptyState
          title="No subscription on this Company"
          description="This Company isn't billed through Stripe yet. Personal Companies on the founder account are exempt; joint Companies bill the creator."
        />
      )}

      {billing && (
        <BillingCard
          billing={billing}
          paymentLast4={paymentLast4}
          onManage={openPortal}
          portalBusy={portalBusy}
        />
      )}

      <ResourcePack />

      {indexerEnabled() && trustAddress && <OnChainTreasury trustAddress={trustAddress} />}
    </div>
  );
}

interface BillingCardProps {
  billing: CompanyBillingRow;
  paymentLast4: string | null;
  onManage: () => void;
  portalBusy: boolean;
}

function BillingCard({ billing, paymentLast4, onManage, portalBusy }: BillingCardProps) {
  const nextCharge = billing.next_charge_at
    ? new Date(billing.next_charge_at).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";

  return (
    <section
      style={{
        background: "var(--color-card)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-md)",
        marginBottom: "var(--space-lg)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-md)",
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)" }}>
            <span style={{ fontWeight: 500 }}>Company subscription</span>
            <Badge variant={STATUS_VARIANT[billing.status]} size="sm">
              {STATUS_LABEL[billing.status]}
            </Badge>
          </div>
          <div
            style={{
              color: "var(--color-text-muted)",
              fontSize: "var(--text-sm)",
              marginTop: "var(--space-xs)",
            }}
          >
            {formatCents(COMPANY_MONTHLY * 100)} / month
            {billing.status === "active" && billing.next_charge_at
              ? ` · next charge ${nextCharge}`
              : ""}
            {paymentLast4 ? ` · card ending ${paymentLast4}` : ""}
          </div>
        </div>
        <Button onClick={onManage} variant="secondary" disabled={portalBusy}>
          {portalBusy ? "Opening…" : "Manage billing"}
        </Button>
      </div>
    </section>
  );
}

function ResourcePack() {
  const items = [
    { label: "Tokens / month", value: RESOURCE_PACK.tokens },
    { label: "Compute", value: RESOURCE_PACK.cpu },
    { label: "Memory", value: RESOURCE_PACK.ram },
    { label: "Storage", value: RESOURCE_PACK.storage },
  ];

  return (
    <section style={{ marginBottom: "var(--space-lg)" }}>
      <h3
        style={{
          margin: "0 0 var(--space-sm) 0",
          fontSize: "var(--text-sm)",
          color: "var(--color-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        Resource pack
      </h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "var(--space-sm)",
        }}
      >
        {items.map((it) => (
          <div
            key={it.label}
            style={{
              background: "var(--color-card)",
              borderRadius: "var(--radius-md)",
              padding: "var(--space-md)",
            }}
          >
            <div
              style={{
                color: "var(--color-text-muted)",
                fontSize: "var(--text-sm)",
              }}
            >
              {it.label}
            </div>
            <div style={{ fontWeight: 500, marginTop: 2 }}>{it.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function OnChainTreasury({ trustAddress }: { trustAddress: string }) {
  const [modules, setModules] = useState<IndexedModule[] | null>(null);
  const [holders, setHolders] = useState<IndexedTokenBalance[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mods = await fetchTrustModules(trustAddress);
        if (cancelled) return;
        setModules(mods);
        const tokenModule = findModuleByType(mods, "token");
        if (tokenModule) {
          const balances = await fetchTokenHolders(tokenModule.moduleAddress);
          if (!cancelled) setHolders(balances);
        }
      } catch {
        if (!cancelled) setModules([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trustAddress]);

  if (!modules || modules.length === 0) return null;

  return (
    <section style={{ marginTop: "var(--space-xl)" }}>
      <h3
        style={{
          margin: "0 0 var(--space-sm) 0",
          fontSize: "var(--text-sm)",
          color: "var(--color-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        On-chain mirror
      </h3>
      <p
        style={{
          color: "var(--color-text-muted)",
          fontSize: "var(--text-sm)",
          margin: "0 0 var(--space-sm) 0",
        }}
      >
        TRUST <code style={{ fontFamily: "var(--font-mono)" }}>{trustAddress.slice(0, 14)}…</code> ·{" "}
        {modules.length} modules · {holders.length} token holders
      </p>
    </section>
  );
}
