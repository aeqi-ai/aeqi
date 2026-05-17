import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useVisibleIdeas } from "@/queries/ideas";
import { ideaKeys } from "@/queries/keys";
import { Button, Input, Textarea } from "@/components/ui";
import { formatMediumDate } from "@/lib/i18n";
import type { Idea } from "@/lib/types";

import "@/styles/goals.css";

/**
 * Goals tab — entity-scope view of Ideas with `kind=goal`.
 *
 * Goals are Ideas-family (per design canon
 * architecture/kind-taxonomy-and-the-structural-vs-categorical-rule).
 * They live in the same `ideas` table as notes/files but render with a
 * goal-shaped affordance — metric chip, deadline, status — so the
 * "where are we going?" question has a first-class surface.
 *
 * Phase 1.3 scope: list view + create flow. Detail page deferred to
 * Phase 1.3.1; metric rollups from descendant Quest closures deferred
 * to Phase 2.
 */
export default function EntityGoalsTab({ entityId: _entityId }: { entityId: string }) {
  const ideasQuery = useVisibleIdeas();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);

  const goals = useMemo(
    () => (ideasQuery.data ?? []).filter((i: Idea) => (i.kind ?? "note") === "goal"),
    [ideasQuery.data],
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ideaKeys.visible });
  };

  return (
    <section className="goals-tab">
      <header className="goals-tab__header">
        <div>
          <h1 className="goals-tab__title">Goals</h1>
          <p className="goals-tab__subtitle">
            Directional outcomes this TRUST is pursuing. Goals contain Projects; Projects emit
            Quests.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          + New goal
        </Button>
      </header>

      {goals.length === 0 ? (
        <div className="goals-tab__empty">
          <p>No goals yet. Set a direction — what outcome are you pursuing?</p>
          <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
            + New goal
          </Button>
        </div>
      ) : (
        <ul className="goals-tab__list">
          {goals.map((g) => (
            <GoalRow key={g.id} goal={g} />
          ))}
        </ul>
      )}

      {creating && (
        <NewGoalDialog
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

function GoalRow({ goal }: { goal: Idea }) {
  const props = (goal.properties ?? {}) as Record<string, unknown>;
  const target = typeof props.target === "number" ? props.target : null;
  const current = typeof props.current === "number" ? props.current : null;
  const unit = typeof props.unit === "string" ? props.unit : null;
  const deadline = typeof props.deadline === "string" ? props.deadline : null;
  const status = typeof props.status === "string" ? props.status : "active";

  const metric =
    target !== null
      ? `${current !== null ? current : 0}${unit ?? ""} / ${target}${unit ?? ""}`
      : null;

  return (
    <li className={`goals-row goals-row--status-${status}`}>
      <div className="goals-row__main">
        <h3 className="goals-row__name">{goal.name}</h3>
        {goal.content && <p className="goals-row__content">{goal.content}</p>}
      </div>
      <div className="goals-row__chips">
        {metric && <span className="goals-row__chip goals-row__chip--metric">{metric}</span>}
        {deadline && (
          <span className="goals-row__chip goals-row__chip--deadline">
            by {formatDeadline(deadline)}
          </span>
        )}
        <span
          className={`goals-row__chip goals-row__chip--status goals-row__chip--status-${status}`}
        >
          {status}
        </span>
      </div>
    </li>
  );
}

function formatDeadline(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return formatMediumDate(d);
}

function NewGoalDialog({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [target, setTarget] = useState("");
  const [unit, setUnit] = useState("");
  const [deadline, setDeadline] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const properties: Record<string, unknown> = { status: "active" };
      if (target.trim()) {
        const parsed = Number(target.trim());
        if (!isNaN(parsed)) properties.target = parsed;
      }
      if (unit.trim()) properties.unit = unit.trim();
      if (deadline.trim()) properties.deadline = deadline.trim();

      const body = {
        name: name.trim(),
        content: content.trim(),
        kind: "goal",
        properties,
        tags: ["goal"],
      };
      const resp = await fetch("/api/ideas", {
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
    <div className="goals-dialog__backdrop" onClick={onCancel}>
      <div className="goals-dialog" onClick={(e) => e.stopPropagation()}>
        <h2 className="goals-dialog__title">New goal</h2>
        <Input
          label="Goal"
          placeholder="e.g. Hit $10K MRR by Sept"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <Textarea
          label="Why (optional)"
          placeholder="Direction, context, what success looks like…"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
        />
        <div className="goals-dialog__row">
          <Input
            label="Target (optional)"
            placeholder="10000"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            inputMode="decimal"
          />
          <Input
            label="Unit"
            placeholder="USD, users, %…"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          />
        </div>
        <Input
          label="Deadline (optional)"
          type="date"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
        />
        {error && <p className="goals-dialog__error">{error}</p>}
        <div className="goals-dialog__actions">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            loading={submitting}
            disabled={!name.trim()}
          >
            Create goal
          </Button>
        </div>
      </div>
    </div>
  );
}
