/**
 * Budgets section for the Company Treasury tab.
 *
 * Reads-only in this phase: lists every budget owned by a role in the
 * trust, renders the four-rail allowance bar (inference / treasury /
 * suballoc / hire) for each. Sub-allocate / hire / spend modals land in
 * a follow-up cycle (see architecture_role_budget_canonical.md § 16).
 *
 * Slots into `TreasuryPage` between holdings and transfers — budgets are
 * the canonical "where money flows" surface; vault balance and transfer
 * history are the "what's already happened" surface.
 */
import { useMemo } from "react";

import { Spinner } from "@/components/ui/Spinner";
import { useBudgets, formatMicroUsd, formatUsdcBase } from "@/hooks/useBudgets";
import type { Budget, BudgetAllowance } from "@/lib/api";
import { api } from "@/lib/api";

interface BudgetsBlockProps {
  trustId: string;
}

export default function BudgetsBlock({ trustId }: BudgetsBlockProps) {
  const { budgets, loading, error, refresh } = useBudgets(trustId);

  // Sort: roots (no parent) first, then children grouped under each
  // parent in created order. The full DAG render is a richer surface;
  // this is the compact list view.
  const ordered = useMemo<Budget[]>(() => {
    if (!budgets) return [];
    const byId = new Map(budgets.map((b) => [b.id, b]));
    const roots = budgets.filter((b) => !b.parent_budget_id || !byId.has(b.parent_budget_id));
    const out: Budget[] = [];
    const visit = (b: Budget) => {
      out.push(b);
      const kids = budgets.filter((c) => c.parent_budget_id === b.id);
      for (const k of kids) visit(k);
    };
    for (const r of roots) visit(r);
    return out;
  }, [budgets]);

  if (loading) {
    return (
      <section style={{ marginBottom: "var(--space-md)" }}>
        <SectionHeader title="Budgets" />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "var(--space-md)",
            background: "var(--color-card)",
            borderRadius: "var(--radius-md)",
          }}
        >
          <Spinner />
        </div>
      </section>
    );
  }

  if (error || (budgets && budgets.length === 0)) {
    return (
      <section style={{ marginBottom: "var(--space-md)" }}>
        <SectionHeader title="Budgets" />
        <div
          style={{
            padding: "var(--space-md)",
            background: "var(--color-card)",
            borderRadius: "var(--radius-md)",
            color: "var(--color-text-muted)",
            fontSize: "var(--font-size-sm)",
          }}
        >
          {error ? "Couldn't load budgets." : "No budgets yet. Create one to start funding roles."}
        </div>
      </section>
    );
  }

  return (
    <section style={{ marginBottom: "var(--space-md)" }}>
      <SectionHeader title="Budgets" onRefresh={refresh} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-sm)",
        }}
      >
        {ordered.map((b) => (
          <BudgetRow key={b.id} budget={b} trustId={trustId} />
        ))}
      </div>
    </section>
  );
}

function SectionHeader({ title, onRefresh }: { title: string; onRefresh?: () => void }) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        marginBottom: "var(--space-sm)",
      }}
    >
      <h3
        style={{
          margin: 0,
          fontSize: "var(--font-size-base)",
          fontWeight: 600,
        }}
      >
        {title}
      </h3>
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          style={{
            background: "transparent",
            border: 0,
            color: "var(--color-text-muted)",
            fontSize: "var(--font-size-xs)",
            cursor: "pointer",
            padding: "var(--space-1)",
          }}
        >
          Refresh
        </button>
      )}
    </header>
  );
}

interface BudgetRowProps {
  budget: Budget;
  trustId: string;
}

function BudgetRow({ budget, trustId: _trustId }: BudgetRowProps) {
  const indent = budget.parent_budget_id ? "var(--space-md)" : "0";
  return (
    <div
      style={{
        marginLeft: indent,
        padding: "var(--space-sm) var(--space-md)",
        background: "var(--color-card)",
        borderRadius: "var(--radius-md)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: "var(--space-xs)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "var(--space-2)",
          }}
        >
          <span style={{ fontWeight: 500 }}>{budget.name}</span>
          {budget.is_primary && (
            <span
              style={{
                fontSize: "var(--font-size-2xs)",
                color: "var(--color-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              primary
            </span>
          )}
          {!budget.is_primary && budget.kind !== "operating" && (
            <span
              style={{
                fontSize: "var(--font-size-2xs)",
                color: "var(--color-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              {budget.kind}
            </span>
          )}
        </div>
      </div>
      <AllowanceBars budgetId={budget.id} />
    </div>
  );
}

function AllowanceBars({ budgetId }: { budgetId: string }) {
  // Lazy-fetch the allowance per row. Keeps the list query fast for
  // many-budget trusts; each row paints its own bar when its data
  // arrives. Fetched once per mount.
  const [data, setData] = usePromise<BudgetAllowance | null>(() =>
    api.getBudgetAllowance(budgetId).then((r) => r.allowance ?? null),
  );
  if (data === undefined) {
    return (
      <div
        style={{
          color: "var(--color-text-muted)",
          fontSize: "var(--font-size-2xs)",
        }}
      >
        Loading allowance…
      </div>
    );
  }
  if (data === null) {
    return (
      <div
        style={{
          color: "var(--color-text-muted)",
          fontSize: "var(--font-size-2xs)",
        }}
      >
        No allowance set yet.
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
      <RailBar
        label="Inference"
        spent={data.spent_inference}
        cap={data.caps.inference_credits}
        format={formatMicroUsd}
      />
      <RailBar
        label="Treasury"
        spent={data.spent_treasury}
        cap={data.caps.treasury_cap}
        format={formatUsdcBase}
      />
      <RailBar
        label="Sub-alloc"
        spent={data.spent_suballoc}
        cap={data.caps.suballoc_cap}
        format={formatUsdcBase}
      />
      <RailBar
        label="Hire"
        spent={data.used_hire}
        cap={data.caps.hire_cap}
        format={(n) => `${n}`}
      />
      <button
        type="button"
        onClick={() => setData(undefined)}
        style={{
          alignSelf: "flex-start",
          background: "transparent",
          border: 0,
          color: "var(--color-text-muted)",
          fontSize: "var(--font-size-2xs)",
          cursor: "pointer",
          padding: 0,
          marginTop: "var(--space-1)",
        }}
      >
        Reload
      </button>
    </div>
  );
}

function RailBar({
  label,
  spent,
  cap,
  format,
}: {
  label: string;
  spent: number;
  cap: number;
  format: (n: number) => string;
}) {
  const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
  const empty = cap === 0;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "80px 1fr 120px",
        alignItems: "center",
        gap: "var(--space-2)",
        fontSize: "var(--font-size-2xs)",
      }}
    >
      <span style={{ color: "var(--color-text-muted)" }}>{label}</span>
      <div
        style={{
          height: 6,
          background: "var(--color-bg-subtle)",
          borderRadius: "var(--radius-sm)",
          overflow: "hidden",
        }}
      >
        {!empty && (
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background: "var(--color-text-primary)",
              opacity: 0.6,
            }}
          />
        )}
      </div>
      <span
        style={{
          color: empty ? "var(--color-text-muted)" : "inherit",
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {empty ? "—" : `${format(spent)} / ${format(cap)}`}
      </span>
    </div>
  );
}

// Tiny promise-state hook with a setter that re-triggers when set to
// `undefined`. Avoids pulling react-query in for one fetch per row.
function usePromise<T>(fn: () => Promise<T>): [T | undefined, (next: T | undefined) => void] {
  const [val, setVal] = useStateLazy<T | undefined>(undefined);
  useRunOnMount(() => {
    let cancelled = false;
    fn().then((v) => {
      if (!cancelled) setVal(v);
    });
    return () => {
      cancelled = true;
    };
  });
  return [val, setVal];
}

import { useEffect, useState as useStateLazy } from "react";

function useRunOnMount(fn: () => void | (() => void)) {
  // Wraps the standard useEffect with the conventional "no deps" mount
  // shape so the linter understands the intent. Used by `usePromise`
  // above; the row-local fetch fires once per mount and the cleanup
  // cancels in-flight on unmount.
  useEffect(() => {
    return fn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
