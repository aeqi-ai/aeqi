import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import type { Blueprint, RoleOverrideOccupant } from "@/lib/types";
import { useAuthStore } from "@/store/auth";
import { useUIStore } from "@/store/ui";
import { useDaemonStore } from "@/store/daemon";
import { Button, Input, Spinner } from "@/components/ui";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  BlueprintRolePicker,
  buildRoleOverridesPayload,
} from "@/components/blueprints/BlueprintRolePicker";
import { BlueprintTreePreview } from "@/components/blueprints/BlueprintTreePreview";
import { BlueprintSeedCounts } from "@/components/blueprints/BlueprintSeedCounts";
import { FREE, PLANS, type PlanId } from "@/lib/pricing";
import "@/styles/templates.css";
import "@/styles/blueprints-store.css";

/** Picker key: "free" plus the public PlanId values from pricing.ts. */
type PickerPlan = "free" | PlanId;

/**
 * `/start/:slug` — the company setup surface. Sits between picking a
 * Blueprint (catalog or launch picker) and the actual spawn so the
 * operator confirms three things in one flow:
 *
 *   1. Name — what the company is called (defaults to root.name)
 *   2. Team — role overrides via BlueprintRolePicker
 *   3. Plan — Free trial / Launch / Scale (mirrored from pricing.ts)
 *
 * Launch behavior branches on the chosen plan:
 *
 *   - free → spawn directly via `api.spawnBlueprint` and land in the
 *     company. The platform's `free_company_used_at` gate already
 *     responds with 402 if the user has already burned their trial.
 *   - launch / scale → `api.createCheckoutSession` with the chosen
 *     plan + interval + blueprint slug + display_name. The user
 *     bounces to Stripe checkout; on success the existing
 *     post-checkout flow on the platform spawns the Company.
 *     (The role_overrides choice from the picker doesn't yet flow
 *     through the Stripe-checkout spawn — known follow-up. The
 *     direct-free spawn applies them.)
 */
export default function CompanySetupPage() {
  const navigate = useNavigate();
  const { slug = "" } = useParams<{ slug: string }>();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const setActiveEntity = useUIStore((s) => s.setActiveEntity);
  const fetchEntities = useDaemonStore((s) => s.fetchEntities);
  const fetchAgents = useDaemonStore((s) => s.fetchAgents);

  const [blueprint, setBlueprint] = useState<Blueprint | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [overrides, setOverrides] = useState<Record<string, RoleOverrideOccupant>>({});
  const [plan, setPlan] = useState<PickerPlan>("free");
  const [interval, setInterval] = useState<"monthly" | "annual">("monthly");

  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  useEffect(() => {
    document.title = blueprint?.name ? `Set up ${blueprint.name} · aeqi` : "Set up · aeqi";
  }, [blueprint?.name]);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    api
      .getBlueprint(slug)
      .then((resp) => {
        if (cancelled) return;
        if (resp.blueprint) {
          setBlueprint(resp.blueprint);
          setName(resp.blueprint.root?.name ?? resp.blueprint.name);
        } else {
          setLoadError("Blueprint not found.");
        }
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setLoadError(e.message || "Could not reach the blueprint store.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const launch = useCallback(async () => {
    if (!blueprint) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setLaunchError("Give your company a name.");
      return;
    }
    setLaunching(true);
    setLaunchError(null);
    try {
      if (plan === "free") {
        // Free path: direct spawn, role_overrides honored.
        const rolePayload = buildRoleOverridesPayload(blueprint, overrides);
        const resp = await api.spawnBlueprint({
          blueprint: blueprint.slug,
          display_name: trimmed,
          ...(rolePayload.length > 0 ? { role_overrides: rolePayload } : {}),
        });
        if (!resp.ok || !resp.entity_id) {
          setLaunchError("Spawn failed — please try again.");
          setLaunching(false);
          return;
        }
        setActiveEntity(resp.entity_id);
        await Promise.all([fetchEntities(), fetchAgents()]).catch(() => {});
        navigate(`/c/${encodeURIComponent(resp.entity_id)}/overview`);
        return;
      }

      // Paid path: hand off to Stripe checkout. The platform's
      // post-checkout webhook + return URL spawn the Company once
      // payment clears. role_overrides aren't threaded through this
      // path yet — Phase B of the picker work.
      const { url } = await api.createCheckoutSession({
        plan,
        interval,
        blueprint: blueprint.slug,
        display_name: trimmed,
      });
      if (!url) {
        setLaunchError("Checkout failed — couldn't reach Stripe.");
        setLaunching(false);
        return;
      }
      window.location.href = url;
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : "Launch failed.");
      setLaunching(false);
    }
  }, [
    blueprint,
    name,
    overrides,
    plan,
    interval,
    setActiveEntity,
    fetchEntities,
    fetchAgents,
    navigate,
  ]);

  if (loading && !blueprint) {
    return (
      <div className="company-setup">
        <div className="bp-status">
          <Spinner size="sm" /> Loading Blueprint…
        </div>
      </div>
    );
  }

  if (!blueprint) {
    return (
      <div className="company-setup">
        <EmptyState
          title="Blueprint not found."
          description={loadError || "We couldn't find a Blueprint with that slug."}
          action={
            <Button variant="secondary" onClick={() => navigate("/economy/blueprints")}>
              Back to the catalog
            </Button>
          }
        />
      </div>
    );
  }

  const launchLabel = plan === "free" ? "Launch company →" : "Continue to checkout →";

  return (
    <div className="company-setup">
      <header className="company-setup-head">
        <p className="company-setup-eyebrow">Set up · {blueprint.name}</p>
        <h1 className="company-setup-title">Launch your company.</h1>
        <p className="company-setup-sub">
          {blueprint.tagline || "Confirm a name, your team, and your plan."}
        </p>
      </header>

      {/* ── 1. Name ────────────────────────────────────── */}
      <section className="company-setup-section" aria-labelledby="setup-name-heading">
        <header className="company-setup-section-head">
          <h2 id="setup-name-heading" className="company-setup-section-title">
            <span className="company-setup-section-step">1</span>
            Name your company
          </h2>
          <p className="company-setup-section-sub">
            What it's called everywhere in aeqi. You can rename later.
          </p>
        </header>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Atlas Studio"
          autoFocus
        />
      </section>

      {/* ── 2. Team ────────────────────────────────────── */}
      <section className="company-setup-section" aria-labelledby="setup-team-heading">
        <header className="company-setup-section-head">
          <h2 id="setup-team-heading" className="company-setup-section-title">
            <span className="company-setup-section-step">2</span>
            Set up your team
          </h2>
          <p className="company-setup-section-sub">
            Each role ships with a default agent. Swap any for yourself, or leave vacant to hire
            later.
          </p>
        </header>
        <BlueprintTreePreview template={blueprint} />
        <div className="company-setup-counts">
          <BlueprintSeedCounts template={blueprint} />
        </div>
        <BlueprintRolePicker
          template={blueprint}
          userId={userId}
          overrides={overrides}
          onChange={setOverrides}
        />
      </section>

      {/* ── 3. Plan ────────────────────────────────────── */}
      <section className="company-setup-section" aria-labelledby="setup-plan-heading">
        <header className="company-setup-section-head">
          <h2 id="setup-plan-heading" className="company-setup-section-title">
            <span className="company-setup-section-step">3</span>
            Pick a plan
          </h2>
          <p className="company-setup-section-sub">
            Free trial gives you {FREE.tokens} tokens. Upgrade any time as you scale.
          </p>
        </header>

        <div className="plan-interval-toggle" role="tablist" aria-label="Billing interval">
          <button
            type="button"
            role="tab"
            aria-selected={interval === "monthly"}
            className={`plan-interval-btn${interval === "monthly" ? " plan-interval-btn--active" : ""}`}
            onClick={() => setInterval("monthly")}
          >
            Monthly
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={interval === "annual"}
            className={`plan-interval-btn${interval === "annual" ? " plan-interval-btn--active" : ""}`}
            onClick={() => setInterval("annual")}
          >
            Annual <span className="plan-interval-save">save 15%</span>
          </button>
        </div>

        <ul className="plan-grid" role="list">
          {/* Free trial card. Same shape as paid cards but with
              the free-tier copy + token allowance from pricing.ts. */}
          <li>
            <button
              type="button"
              className={`plan-card${plan === "free" ? " plan-card--selected" : ""}`}
              onClick={() => setPlan("free")}
              aria-pressed={plan === "free"}
            >
              <span className="plan-card-name">Free</span>
              <span className="plan-card-price">
                <span className="plan-card-price-amount">$0</span>
                <span className="plan-card-price-cadence">free trial</span>
              </span>
              <span className="plan-card-blurb">Try a Company before committing.</span>
              <ul className="plan-card-features" role="list">
                <li>{FREE.tokens} tokens included</li>
                <li>Multi-agent org chart</li>
                <li>One Company per account</li>
              </ul>
            </button>
          </li>
          {PLANS.map((p) => {
            const selected = plan === p.id;
            const price = interval === "annual" ? p.annualPrice : p.price;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className={`plan-card${selected ? " plan-card--selected" : ""}${
                    p.popular ? " plan-card--popular" : ""
                  }`}
                  onClick={() => setPlan(p.id)}
                  aria-pressed={selected}
                >
                  {p.popular && <span className="plan-card-badge">Most popular</span>}
                  <span className="plan-card-name">{p.name}</span>
                  <span className="plan-card-price">
                    <span className="plan-card-price-amount">${price}</span>
                    <span className="plan-card-price-cadence">
                      / mo{interval === "annual" ? " · billed annually" : ""}
                    </span>
                  </span>
                  <span className="plan-card-blurb">{p.desc}</span>
                  <ul className="plan-card-features" role="list">
                    {p.features.map((f) => (
                      <li key={f.text}>
                        {f.text}
                        {f.soon && <span className="plan-card-feature-soon"> · soon</span>}
                      </li>
                    ))}
                  </ul>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── Launch ─────────────────────────────────────── */}
      {launchError && (
        <div className="bp-error" role="alert">
          {launchError}
        </div>
      )}
      <div className="company-setup-foot">
        <Button
          variant="secondary"
          onClick={() => navigate(`/economy/blueprints/${encodeURIComponent(blueprint.slug)}`)}
          disabled={launching}
        >
          ← Back to Blueprint
        </Button>
        <Button variant="primary" onClick={launch} loading={launching} disabled={!name.trim()}>
          {launchLabel}
        </Button>
      </div>
    </div>
  );
}
