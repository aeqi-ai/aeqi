import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useVisibleIdeas } from "@/queries/ideas";
import { useQuests } from "@/queries/quests";
import { useNav } from "@/hooks/useNav";
import { formatMediumDate } from "@/lib/i18n";
import { Button } from "@/components/ui";
import type { Idea, Quest } from "@/lib/types";

import "@/styles/detail-pages.css";

/**
 * Goal detail page — `/trust/<addr>/goals/<ideaId>` (Phase 2.3 of
 * ae-002). Shows the Goal header + child Projects list (Quests with
 * `kind=project` whose `idea_id === goal.id`).
 *
 * Phase 2.3 ships the minimum viable detail: header + Projects list +
 * back link. Metric editor (Shape A goals with target/current/unit),
 * retrospective surface, and child-Idea sub-list are Phase 2.3.1+.
 */
export default function EntityGoalDetailPage({
  entityId: _entityId,
  goalId,
}: {
  entityId: string;
  goalId: string;
}) {
  const ideasQuery = useVisibleIdeas();
  const quests = useQuests();
  const navigate = useNavigate();
  const { entityId } = useNav();

  const goal = useMemo(
    () => (ideasQuery.data ?? []).find((i: Idea) => i.id === goalId),
    [ideasQuery.data, goalId],
  );
  const childProjects = useMemo(
    () => quests.filter((q: Quest) => (q.kind ?? "task") === "project" && q.idea_id === goalId),
    [quests, goalId],
  );

  if (!goal) {
    return (
      <section className="detail-page">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/trust/${entityId}/goals`)}>
          ← Back to Goals
        </Button>
        <div className="detail-page__empty">
          <p>Goal {goalId} not found in this entity.</p>
        </div>
      </section>
    );
  }

  const props = (goal.properties ?? {}) as Record<string, unknown>;
  const target = typeof props.target === "number" ? props.target : null;
  const current = typeof props.current === "number" ? props.current : 0;
  const unit = typeof props.unit === "string" ? props.unit : null;
  const deadline = typeof props.deadline === "string" ? props.deadline : null;
  const status = typeof props.status === "string" ? props.status : "active";
  const metricPct =
    target !== null && target > 0 ? Math.min(100, Math.round((current / target) * 100)) : null;

  const doneProjects = childProjects.filter((p) => p.status === "done").length;
  const projectPct =
    childProjects.length > 0 ? Math.round((doneProjects / childProjects.length) * 100) : null;

  return (
    <section className="detail-page">
      <div className="detail-page__breadcrumb">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/trust/${entityId}/goals`)}>
          ← Back to Goals
        </Button>
      </div>

      <header className="detail-page__header">
        <h1 className="detail-page__title">{goal.name}</h1>
        <div className="detail-page__chips">
          <span
            className={`detail-page__chip detail-page__chip--status detail-page__chip--status-${status}`}
          >
            {status}
          </span>
          {target !== null && (
            <span className="detail-page__chip detail-page__chip--metric">
              {current}
              {unit ?? ""} / {target}
              {unit ?? ""}
            </span>
          )}
          {deadline && (
            <span className="detail-page__chip detail-page__chip--deadline">
              by {formatMediumDate(new Date(deadline))}
            </span>
          )}
          {projectPct !== null && (
            <span className="detail-page__chip detail-page__chip--rollup">
              {projectPct}% projects · {doneProjects}/{childProjects.length}
            </span>
          )}
        </div>
        {goal.content && <p className="detail-page__summary">{goal.content}</p>}
        {metricPct !== null && (
          <div
            className="detail-page__progress"
            title={`Metric: ${current}${unit ?? ""} / ${target}${unit ?? ""}`}
          >
            <div
              className="detail-page__progress-bar detail-page__progress-bar--metric"
              style={{ width: `${metricPct}%` }}
            />
          </div>
        )}
      </header>

      <section className="detail-page__section">
        <h2 className="detail-page__section-title">Projects</h2>
        {childProjects.length === 0 ? (
          <p className="detail-page__empty-note">
            No Projects yet. Initiatives serving this Goal land here when they're created with
            <code> idea_id = "{goal.id}"</code>.
          </p>
        ) : (
          <ul className="detail-page__work-list">
            {childProjects.map((p) => (
              <li
                key={p.id}
                className={`detail-page__work-row detail-page__work-row--status-${p.status}`}
              >
                <button
                  type="button"
                  className="detail-page__work-link"
                  onClick={() => navigate(`/trust/${entityId}/projects/${p.id}`)}
                >
                  <span className={`detail-page__work-dot detail-page__work-dot--${p.status}`} />
                  <span className="detail-page__work-name">{p.idea?.name ?? p.id}</span>
                  <span className="detail-page__work-status">{p.status}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
