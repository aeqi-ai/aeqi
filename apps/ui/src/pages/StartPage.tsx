import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BlueprintSeedCounts } from "@/components/blueprints/BlueprintSeedCounts";
import { Banner, Button, Card, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { blueprintId } from "@/lib/blueprintId";
import { DEFAULT_BLUEPRINT_SLUG } from "@/lib/blueprintDefaults";
import { countBlueprintStructures } from "@/lib/blueprintStructures";
import { Events, useTrack } from "@/lib/analytics";
import { RECOMMENDED_BLUEPRINTS } from "@/lib/recommendedBlueprints";
import type { SingleBlueprint as Blueprint } from "@/lib/types";
import { isSingleBlueprint } from "@/lib/types";
import { useAuthStore } from "@/store/auth";
import "@/styles/blueprints-store.css";
import "@/styles/blueprint-launch-picker.css";

function pickInitialBlueprintId(
  blueprints: Blueprint[],
  byBlueprintId: Map<string, Blueprint>,
): string | null {
  for (const id of RECOMMENDED_BLUEPRINTS) {
    if (byBlueprintId.has(id)) return id;
  }
  if (byBlueprintId.has(DEFAULT_BLUEPRINT_SLUG)) return DEFAULT_BLUEPRINT_SLUG;
  return blueprints[0] ? blueprintId(blueprints[0]) : null;
}

function formatChoiceMeta(template: Blueprint): string {
  const parts: string[] = [];
  const agents = (template.seed_agents?.length ?? 0) + 1;
  const structures = countBlueprintStructures(template);
  const events = template.seed_events?.length ?? 0;
  const ideas = template.seed_ideas?.length ?? 0;
  const quests = template.seed_quests?.length ?? 0;
  parts.push(`${agents} ${agents === 1 ? "agent" : "agents"}`);
  if (structures > 1) parts.push(`${structures} structures`);
  if (events > 0) parts.push(`${events} ${events === 1 ? "event" : "events"}`);
  if (ideas > 0) parts.push(`${ideas} ${ideas === 1 ? "idea" : "ideas"}`);
  if (quests > 0) parts.push(`${quests} ${quests === 1 ? "quest" : "quests"}`);
  return parts.join(" · ");
}

/**
 * `/launch` is the canonical launch selector. It stays intentionally small:
 * choose a blueprint here, inspect the template on the Blueprint page, then
 * continue into the setup wizard.
 */
export default function StartPage() {
  const navigate = useNavigate();
  const track = useTrack();
  const token = useAuthStore((s) => s.token);
  const authMode = useAuthStore((s) => s.authMode);

  const isAuthed = authMode === "none" || !!token;
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [selectedBlueprintId, setSelectedBlueprintId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Launch an organization · aeqi";
  }, []);

  useEffect(() => {
    if (!isAuthed) {
      navigate(`/signup?next=${encodeURIComponent("/launch")}`, { replace: true });
      return;
    }
    track(Events.CompanyCreateStart, { surface: "launch" });
  }, [isAuthed, navigate, track]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    api
      .getBlueprints()
      .then((resp) => {
        if (cancelled) return;
        setBlueprints((resp.blueprints ?? []).filter(isSingleBlueprint));
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setLoadError(e.message || "Could not reach the Blueprint store.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const byBlueprintId = useMemo(() => {
    const m = new Map<string, Blueprint>();
    for (const blueprint of blueprints) {
      m.set(blueprintId(blueprint), blueprint);
    }
    return m;
  }, [blueprints]);

  const selectedBlueprint = useMemo(() => {
    if (selectedBlueprintId && byBlueprintId.has(selectedBlueprintId)) {
      return byBlueprintId.get(selectedBlueprintId) ?? null;
    }
    const initial = pickInitialBlueprintId(blueprints, byBlueprintId);
    return initial ? (byBlueprintId.get(initial) ?? null) : null;
  }, [blueprints, byBlueprintId, selectedBlueprintId]);

  useEffect(() => {
    if (blueprints.length === 0) return;
    const initial = pickInitialBlueprintId(blueprints, byBlueprintId);
    if (!initial) return;
    setSelectedBlueprintId((current) =>
      current && byBlueprintId.has(current) ? current : initial,
    );
  }, [blueprints, byBlueprintId]);

  const launchChoices = useMemo(() => {
    const ids: string[] = [];
    const add = (id: string | null | undefined) => {
      if (!id || ids.includes(id) || !byBlueprintId.has(id)) return;
      ids.push(id);
    };

    add(DEFAULT_BLUEPRINT_SLUG);
    for (const id of RECOMMENDED_BLUEPRINTS) add(id);
    for (const blueprint of blueprints) {
      if (ids.length >= 5) break;
      add(blueprintId(blueprint));
    }

    return ids.map((id) => byBlueprintId.get(id)).filter((t): t is Blueprint => !!t);
  }, [blueprints, byBlueprintId]);

  const handleContinue = useCallback(() => {
    if (!selectedBlueprint) return;
    navigate(`/launch/${encodeURIComponent(blueprintId(selectedBlueprint))}`);
  }, [navigate, selectedBlueprint]);

  const handleSelectBlueprint = useCallback((id: string) => {
    setSelectedBlueprintId(id);
  }, []);

  if (!isAuthed) return null;

  return (
    <div className="start-page start-page--launch">
      <header className="start-head start-head--launch">
        <div className="start-head-copy">
          <p className="start-eyebrow">Launch</p>
          <h1 className="page-title">Start an organization.</h1>
          <p className="start-sub">
            Pick a blueprint here. Detailed previews live on the Blueprint page.
          </p>
        </div>
        <div className="start-head-actions">
          <Link to="/blueprints" className="start-secondary-link">
            Browse blueprints
          </Link>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleContinue}
            disabled={loading || !selectedBlueprint}
          >
            Launch
          </Button>
        </div>
      </header>

      {loadError && (
        <Banner kind="error" className="start-banner">
          {loadError}
        </Banner>
      )}

      <section className="start-launch-grid" aria-label="Launch wizard">
        <aside className="start-launch-list">
          <div className="start-pane-head">
            <p className="start-section-kicker">Blueprints</p>
            <h2 className="start-section-title">Choose a starting structure.</h2>
            <p className="start-sub">
              Select a blueprint to continue. The setup wizard comes next.
            </p>
          </div>

          {loading ? (
            <div className="start-loading-state" role="status" aria-live="polite">
              <Spinner size="sm" /> Loading blueprints…
            </div>
          ) : (
            <div className="start-choice-grid" role="list">
              {launchChoices.map((template) => {
                const templateId = blueprintId(template);
                const active = selectedBlueprint
                  ? blueprintId(selectedBlueprint) === templateId
                  : false;
                return (
                  <button
                    key={templateId}
                    type="button"
                    className="start-choice-card-btn"
                    role="listitem"
                    onClick={() => handleSelectBlueprint(templateId)}
                    aria-pressed={active}
                    aria-label={`${template.name}${template.tagline ? ` — ${template.tagline}` : ""}`}
                  >
                    <Card
                      variant="default"
                      padding="md"
                      interactive
                      className={`start-choice-card${active ? " start-choice-card--active" : ""}`}
                    >
                      <div className="start-choice-card-top">
                        <h3 className="start-choice-card-name">{template.name}</h3>
                        {active && <span className="start-choice-card-badge">Selected</span>}
                      </div>
                      {template.tagline && (
                        <p className="start-choice-card-tagline">{template.tagline}</p>
                      )}
                      <p className="start-choice-card-meta">{formatChoiceMeta(template)}</p>
                    </Card>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <aside className="start-launch-summary">
          <Card variant="default" padding="lg" className="start-launch-summary-card">
            <p className="start-section-kicker">Selected blueprint</p>
            <h2 className="start-launch-summary-title">
              {selectedBlueprint?.name ?? "Select a blueprint"}
            </h2>
            <p className="start-sub">
              {selectedBlueprint?.tagline ?? "Pick one on the left to continue."}
            </p>

            {selectedBlueprint ? (
              <>
                <BlueprintSeedCounts template={selectedBlueprint} />
                <ul className="start-launch-summary-list">
                  <li>Name it on the next screen.</li>
                  <li>Set roles, funding, vesting, and governance there.</li>
                  <li>Preview details stay on the Blueprint page.</li>
                </ul>
                <div className="start-launch-summary-actions">
                  <Link
                    to={`/blueprints/${encodeURIComponent(blueprintId(selectedBlueprint))}`}
                    className="start-secondary-link"
                  >
                    View template
                  </Link>
                </div>
              </>
            ) : (
              <div className="start-loading-state" role="status" aria-live="polite">
                No blueprints are available yet.
              </div>
            )}
          </Card>

          <p className="start-help">
            The next step is the setup wizard. That is where you configure the organization.
          </p>
        </aside>
      </section>
    </div>
  );
}
