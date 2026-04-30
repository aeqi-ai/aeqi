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
import "@/styles/templates.css";
import "@/styles/blueprints-store.css";

type PlanKey = "solo" | "studio" | "agency";

interface PlanCard {
  key: PlanKey;
  name: string;
  price: string;
  cadence: string;
  blurb: string;
  features: string[];
}

/**
 * Plan tiers shown at provision time. Solo is the free-trial default
 * (one company, the platform's existing free_company_used gate). Studio
 * and Agency are paid; selecting them captures intent in the spawn
 * payload but real Stripe checkout / subscription_plan persistence is
 * a follow-up — the platform's `/api/start/launch` already returns 402
 * `trial_used` when a non-paying user tries to spawn a second company.
 *
 * Pricing copy is informational, not transactional yet.
 */
const PLANS: PlanCard[] = [
  {
    key: "solo",
    name: "Solo",
    price: "$0",
    cadence: "free trial",
    blurb: "One company, casual exploration.",
    features: ["1 company", "Multi-agent org chart", "Full role primitive"],
  },
  {
    key: "studio",
    name: "Studio",
    price: "$29",
    cadence: "per month",
    blurb: "Multi-company operators.",
    features: ["Up to 3 companies", "Priority spawn queue", "Email support"],
  },
  {
    key: "agency",
    name: "Agency",
    price: "Custom",
    cadence: "per seat",
    blurb: "White-label, unlimited scale.",
    features: ["Unlimited companies", "White-label branding", "Dedicated runtime"],
  },
];

/**
 * `/start/:slug` — the company setup surface. Sits between picking a
 * Blueprint (catalog or launch picker) and the actual spawn so the
 * operator confirms three things in one flow:
 *
 *   1. Name — what the company is called (defaults to root.name)
 *   2. Team — role overrides via BlueprintRolePicker
 *   3. Plan — Solo (free) / Studio / Agency
 *
 * On launch, calls `api.spawnBlueprint` with `display_name` +
 * `role_overrides`. Plan selection is captured in the payload as a
 * forward-compatible hint; the platform's billing gate
 * (`free_company_used`) still controls whether the spawn proceeds.
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
  const [plan, setPlan] = useState<PlanKey>("solo");

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
      // Refresh stores so the destination paints immediately.
      await Promise.all([fetchEntities(), fetchAgents()]).catch(() => {});
      navigate(`/c/${encodeURIComponent(resp.entity_id)}/overview`);
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : "Spawn failed.");
      setLaunching(false);
    }
    // Plan selection is captured in `plan` state but not yet on the
    // wire — TODO: thread `subscription_plan` through `/api/start/launch`
    // when wiring real Stripe checkout. For now the platform's
    // existing `free_company_used` gate handles trial→paid transition.
    void plan;
  }, [blueprint, name, overrides, plan, setActiveEntity, fetchEntities, fetchAgents, navigate]);

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
            Solo is free for your first company. Upgrade any time as you scale.
          </p>
        </header>
        <ul className="plan-grid" role="list">
          {PLANS.map((p) => {
            const selected = plan === p.key;
            return (
              <li key={p.key}>
                <button
                  type="button"
                  className={`plan-card${selected ? " plan-card--selected" : ""}`}
                  onClick={() => setPlan(p.key)}
                  aria-pressed={selected}
                >
                  <span className="plan-card-name">{p.name}</span>
                  <span className="plan-card-price">
                    <span className="plan-card-price-amount">{p.price}</span>
                    <span className="plan-card-price-cadence">{p.cadence}</span>
                  </span>
                  <span className="plan-card-blurb">{p.blurb}</span>
                  <ul className="plan-card-features" role="list">
                    {p.features.map((f) => (
                      <li key={f}>{f}</li>
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
          Launch company →
        </Button>
      </div>
    </div>
  );
}
