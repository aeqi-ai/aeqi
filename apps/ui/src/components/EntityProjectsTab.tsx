import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useQuests } from "@/queries/quests";
import { questKeys } from "@/queries/keys";
import { Button, Input, Textarea } from "@/components/ui";
import { formatMediumDate } from "@/lib/i18n";
import type { Quest } from "@/lib/types";

import "@/styles/projects.css";

/**
 * Projects tab — entity-scope view of Quests with `kind=project`.
 *
 * Projects are Quests-family (per design canon
 * architecture/kind-taxonomy-and-the-structural-vs-categorical-rule).
 * They share the `quests` table but render with container semantics —
 * sub-quest count, status pill, lead-Role assignee — so "what's in
 * flight?" has a first-class surface separate from atomic tasks.
 *
 * Phase 1.4 scope: list view + create flow. Detail page (Plan + Work
 * tabs) deferred to Phase 1.4.1. Retrospective enforcement on close
 * lives at the agent-tool boundary (Phase 1.2), not the UI.
 */
export default function EntityProjectsTab({ entityId: _entityId }: { entityId: string }) {
  const quests = useQuests();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);

  const projects = useMemo(
    () => quests.filter((q: Quest) => (q.kind ?? "task") === "project"),
    [quests],
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: questKeys.all });
  };

  return (
    <section className="projects-tab">
      <header className="projects-tab__header">
        <div>
          <h1 className="projects-tab__title">Projects</h1>
          <p className="projects-tab__subtitle">
            Bounded initiatives this TRUST is running. Projects contain Quests and roll up to Goals.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          + New project
        </Button>
      </header>

      {projects.length === 0 ? (
        <div className="projects-tab__empty">
          <p>No projects yet. Spin up a bounded initiative — a chunk of work with a deliverable.</p>
          <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
            + New project
          </Button>
        </div>
      ) : (
        <ul className="projects-tab__list">
          {projects.map((p) => (
            <ProjectRow key={p.id} project={p} allQuests={quests} />
          ))}
        </ul>
      )}

      {creating && (
        <NewProjectDialog
          onCancel={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            refresh();
          }}
        />
      )}
    </section>
  );
}

function ProjectRow({ project, allQuests }: { project: Quest; allQuests: Quest[] }) {
  const status = project.status;
  const dueAt = project.due_at;
  const cost = project.cost_usd;
  const title = project.idea?.name ?? project.id;
  const summary = project.idea?.content?.slice(0, 200) ?? "";
  const rollup = useMemo(
    () => computeProjectRollup(project.id, allQuests),
    [project.id, allQuests],
  );

  return (
    <li className={`projects-row projects-row--status-${status}`}>
      <div className="projects-row__main">
        <h3 className="projects-row__name">{title}</h3>
        {summary && <p className="projects-row__content">{summary}</p>}
        {rollup && (
          <div
            className="projects-row__progress"
            title={`${rollup.done} of ${rollup.total} sub-Quests done`}
          >
            <div className="projects-row__progress-bar" style={{ width: `${rollup.pct}%` }} />
          </div>
        )}
      </div>
      <div className="projects-row__chips">
        {rollup && (
          <span className="projects-row__chip projects-row__chip--rollup">
            {rollup.pct}% · {rollup.done}/{rollup.total}
          </span>
        )}
        <span
          className={`projects-row__chip projects-row__chip--status projects-row__chip--status-${status}`}
        >
          {status}
        </span>
        {dueAt && (
          <span className="projects-row__chip projects-row__chip--deadline">
            by {formatDueDate(dueAt)}
          </span>
        )}
        {cost > 0 && (
          <span className="projects-row__chip projects-row__chip--cost">${cost.toFixed(2)}</span>
        )}
      </div>
    </li>
  );
}

/**
 * Sub-quest rollup for a Project. Counts direct child Quests via
 * `quest.parent === project.id` (the field the Phase 1.1 schema added).
 * Mirrors `computeRollup` in EntityGoalsTab but scoped to Quest.parent
 * rather than Goal.idea_id. Returns null when no sub-quests exist.
 */
function computeProjectRollup(
  projectId: string,
  allQuests: Quest[],
): { done: number; total: number; pct: number } | null {
  const direct = allQuests.filter((q) => (q.metadata?.parent_id ?? null) === projectId);
  if (direct.length === 0) return null;
  const done = direct.filter((q) => q.status === "done").length;
  return { done, total: direct.length, pct: Math.round((done / direct.length) * 100) };
}

function formatDueDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return formatMediumDate(d);
}

function NewProjectDialog({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!subject.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        subject: subject.trim(),
        description: description.trim(),
        kind: "project",
      };
      if (deadline.trim()) body.due_at = deadline.trim();

      const resp = await fetch("/api/quests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(err || `HTTP ${resp.status}`);
      }
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="projects-dialog__backdrop" onClick={onCancel}>
      <div className="projects-dialog" onClick={(e) => e.stopPropagation()}>
        <h2 className="projects-dialog__title">New project</h2>
        <Input
          label="Project"
          placeholder="e.g. Launch v1 product"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          autoFocus
        />
        <Textarea
          label="What ships when it's done (optional)"
          placeholder="Scope, deliverables, what 'done' looks like…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />
        <Input
          label="Target date (optional)"
          type="date"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
        />
        {error && <p className="projects-dialog__error">{error}</p>}
        <div className="projects-dialog__actions">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            loading={submitting}
            disabled={!subject.trim()}
          >
            Create project
          </Button>
        </div>
      </div>
    </div>
  );
}
