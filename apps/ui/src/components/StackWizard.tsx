/**
 * StackWizard — 5-step wizard for deploying a stack blueprint.
 *
 * Step 1 (rename)   — show tree with editable names per slot
 * Step 2 (review)   — confirm what will deploy (N TRUSTs + edges)
 * Step 3 (spawning) — POST /api/start/stack, show live progress
 * Step 4 (success)  — list new Companies with /trust/<addr> links
 *
 * Failure path: per-component errors surface inline; user can skip
 * failed components and continue to success, or abort the whole run.
 *
 * Design: no fullscreen takeover — renders inside a Modal.
 * Tokens only; no hex literals; no hairlines.
 */

import { useCallback, useId, useReducer, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import type { StackBlueprint, StackComponentOutcome, StackEdgeOutcome } from "@/lib/types";
import { Button, Input, Modal, Spinner } from "@/components/ui";
import "@/styles/stack-wizard.css";

// ── Types ─────────────────────────────────────────────────────────

type WizardStep = "rename" | "review" | "spawning" | "success" | "error";

interface WizardState {
  step: WizardStep;
  names: Record<string, string>;
  components: StackComponentOutcome[];
  edgeResults: StackEdgeOutcome[];
  globalError: string | null;
}

type WizardAction =
  | { type: "SET_NAME"; slot: string; value: string }
  | { type: "NEXT_STEP"; to: WizardStep }
  | { type: "SET_RESULT"; components: StackComponentOutcome[]; edgeResults: StackEdgeOutcome[] }
  | { type: "SET_ERROR"; error: string };

function initState(stack: StackBlueprint): WizardState {
  const names: Record<string, string> = {};
  for (const c of stack.components) {
    names[c.slot] = c.display_name_default;
  }
  return { step: "rename", names, components: [], edgeResults: [], globalError: null };
}

function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "SET_NAME":
      return { ...state, names: { ...state.names, [action.slot]: action.value } };
    case "NEXT_STEP":
      return { ...state, step: action.to, globalError: null };
    case "SET_RESULT":
      return {
        ...state,
        step: action.components.some((c) => c.status === "ok") ? "success" : "error",
        components: action.components,
        edgeResults: action.edgeResults,
      };
    case "SET_ERROR":
      return { ...state, step: "error", globalError: action.error };
    default:
      return state;
  }
}

// ── Main component ─────────────────────────────────────────────────

export interface StackWizardProps {
  stack: StackBlueprint;
  open: boolean;
  onClose: () => void;
}

export function StackWizard({ stack, open, onClose }: StackWizardProps) {
  const [state, dispatch] = useReducer(reducer, stack, initState);
  const spawnRef = useRef(false);

  const handleSpawn = useCallback(async () => {
    if (spawnRef.current) return;
    spawnRef.current = true;
    dispatch({ type: "NEXT_STEP", to: "spawning" });
    try {
      const result = await api.startStack({ stack_id: stack.id, names: state.names });
      dispatch({
        type: "SET_RESULT",
        components: result.components,
        edgeResults: result.edge_results,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Stack provisioning failed.";
      dispatch({ type: "SET_ERROR", error: msg });
    } finally {
      spawnRef.current = false;
    }
  }, [stack.id, state.names]);

  const title =
    state.step === "rename"
      ? "Name your companies"
      : state.step === "review"
        ? "Review before deploying"
        : state.step === "spawning"
          ? "Deploying…"
          : state.step === "success"
            ? "Stack deployed"
            : "Deployment failed";

  return (
    <Modal
      open={open}
      onClose={
        state.step !== "spawning"
          ? onClose
          : () => {
              /* locked during spawn */
            }
      }
      title={title}
    >
      <div className="sw-body">
        {state.step === "rename" && (
          <RenameStep
            stack={stack}
            names={state.names}
            dispatch={dispatch}
            onNext={() => dispatch({ type: "NEXT_STEP", to: "review" })}
          />
        )}
        {state.step === "review" && (
          <ReviewStep
            stack={stack}
            names={state.names}
            onBack={() => dispatch({ type: "NEXT_STEP", to: "rename" })}
            onConfirm={handleSpawn}
          />
        )}
        {state.step === "spawning" && <SpawningStep stack={stack} names={state.names} />}
        {state.step === "success" && (
          <SuccessStep
            components={state.components}
            edgeResults={state.edgeResults}
            onClose={onClose}
          />
        )}
        {state.step === "error" && (
          <ErrorStep
            globalError={state.globalError}
            components={state.components}
            onClose={onClose}
            onRetry={() => {
              spawnRef.current = false;
              dispatch({ type: "NEXT_STEP", to: "review" });
            }}
          />
        )}
      </div>
    </Modal>
  );
}

// ── Step 1 — Rename ────────────────────────────────────────────────

interface RenameStepProps {
  stack: StackBlueprint;
  names: Record<string, string>;
  dispatch: React.Dispatch<WizardAction>;
  onNext: () => void;
}

function RenameStep({ stack, names, dispatch, onNext }: RenameStepProps) {
  const baseId = useId();
  const allNamed = stack.components.every((c) => (names[c.slot] ?? "").trim().length > 0);

  return (
    <>
      <p className="sw-description">{stack.tagline}</p>
      <StackTreePreview stack={stack} names={names} />
      <div className="sw-fields">
        {stack.components.map((c) => {
          const fieldId = `${baseId}-${c.slot}`;
          return (
            <div key={c.slot} className="sw-field-row">
              <label htmlFor={fieldId} className="sw-field-label">
                {c.slot}
              </label>
              <Input
                id={fieldId}
                value={names[c.slot] ?? c.display_name_default}
                onChange={(e) =>
                  dispatch({ type: "SET_NAME", slot: c.slot, value: e.target.value })
                }
                placeholder={c.display_name_default}
                size="sm"
              />
            </div>
          );
        })}
      </div>
      <div className="sw-footer">
        <Button variant="primary" size="sm" disabled={!allNamed} onClick={onNext}>
          Review →
        </Button>
      </div>
    </>
  );
}

// ── Step 2 — Review ────────────────────────────────────────────────

interface ReviewStepProps {
  stack: StackBlueprint;
  names: Record<string, string>;
  onBack: () => void;
  onConfirm: () => void;
}

function formatRelationship(rel: {
  type: string;
  percent_bps?: number;
  role_type?: string;
  amount_usd?: number;
}): string {
  if (rel.type === "token_ownership" && rel.percent_bps != null) {
    return `${(rel.percent_bps / 100).toFixed(0)}% token ownership`;
  }
  if (rel.type === "role_assignment" && rel.role_type) {
    return `${rel.role_type} role assignment`;
  }
  if (rel.type === "treasury_flow" && rel.amount_usd != null) {
    return `treasury flow $${(rel.amount_usd / 100).toFixed(2)}/period`;
  }
  return rel.type.replace(/_/g, " ");
}

function ReviewStep({ stack, names, onBack, onConfirm }: ReviewStepProps) {
  return (
    <>
      <section className="sw-review-section">
        <h3 className="sw-review-heading">Companies to deploy</h3>
        <ul className="sw-review-list" role="list">
          {stack.components.map((c) => (
            <li key={c.slot} className="sw-review-row">
              <span className="sw-review-name">{names[c.slot] || c.display_name_default}</span>
              <span className="sw-review-meta">
                {c.slot} · {c.blueprint_id}
              </span>
            </li>
          ))}
        </ul>
      </section>
      {stack.edge_count > 0 && (
        <section className="sw-review-section">
          <h3 className="sw-review-heading">Cross-company edges</h3>
          <ul className="sw-review-list" role="list">
            {/* edges aren't in the catalog summary — show count */}
            <li className="sw-review-row">
              <span className="sw-review-meta">
                {stack.edge_count} {stack.edge_count === 1 ? "edge" : "edges"} will be applied after
                provisioning
              </span>
            </li>
          </ul>
        </section>
      )}
      <p className="sw-review-note">
        Each company deploys an on-chain TRUST. This action cannot be undone.
      </p>
      <div className="sw-footer sw-footer--split">
        <Button variant="secondary" size="sm" onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" size="sm" onClick={onConfirm}>
          Deploy stack
        </Button>
      </div>
    </>
  );
}

// ── Step 3 — Spawning ──────────────────────────────────────────────

interface SpawningStepProps {
  stack: StackBlueprint;
  names: Record<string, string>;
}

function SpawningStep({ stack, names }: SpawningStepProps) {
  return (
    <div className="sw-spawning">
      <Spinner size="md" />
      <p className="sw-spawning-label">
        Deploying {stack.components.length}{" "}
        {stack.components.length === 1 ? "company" : "companies"}…
      </p>
      <ul className="sw-spawn-list" role="list">
        {stack.components.map((c) => (
          <li key={c.slot} className="sw-spawn-row sw-spawn-row--pending">
            <span className="sw-spawn-dot" aria-hidden />
            <span className="sw-spawn-name">{names[c.slot] || c.display_name_default}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Step 4 — Success ───────────────────────────────────────────────

interface SuccessStepProps {
  components: StackComponentOutcome[];
  edgeResults: StackEdgeOutcome[];
  onClose: () => void;
}

function SuccessStep({ components, edgeResults, onClose }: SuccessStepProps) {
  const succeeded = components.filter((c) => c.status === "ok");
  const failed = components.filter((c) => c.status !== "ok");
  const edgeFailed = edgeResults.filter((e) => e.status === "failed");

  return (
    <>
      <p className="sw-description">
        {succeeded.length} of {components.length}{" "}
        {components.length === 1 ? "company" : "companies"} deployed.
      </p>
      <ul className="sw-spawn-list" role="list">
        {succeeded.map((c) => (
          <li key={c.slot} className="sw-spawn-row sw-spawn-row--ok">
            <span className="sw-spawn-dot sw-spawn-dot--ok" aria-hidden />
            <div className="sw-spawn-body">
              <span className="sw-spawn-name">{c.entity_id}</span>
              {c.trust_address && (
                <Link
                  to={`/trust/${c.trust_address}`}
                  className="sw-spawn-trust"
                  title="View on-chain TRUST"
                >
                  {c.trust_address.slice(0, 10)}…{c.trust_address.slice(-6)}
                </Link>
              )}
            </div>
          </li>
        ))}
        {failed.map((c) => (
          <li key={c.slot} className="sw-spawn-row sw-spawn-row--fail">
            <span className="sw-spawn-dot sw-spawn-dot--fail" aria-hidden />
            <div className="sw-spawn-body">
              <span className="sw-spawn-name">{c.slot}</span>
              {c.error && <span className="sw-spawn-error">{c.error}</span>}
            </div>
          </li>
        ))}
      </ul>
      {edgeFailed.length > 0 && (
        <p className="sw-review-note">
          {edgeFailed.length} {edgeFailed.length === 1 ? "edge" : "edges"} failed to apply —
          cross-company relationships can be wired manually from each company&rsquo;s governance
          page.
        </p>
      )}
      <div className="sw-footer">
        <Button variant="primary" size="sm" onClick={onClose}>
          Done
        </Button>
      </div>
    </>
  );
}

// ── Error step ─────────────────────────────────────────────────────

interface ErrorStepProps {
  globalError: string | null;
  components: StackComponentOutcome[];
  onClose: () => void;
  onRetry: () => void;
}

function ErrorStep({ globalError, components, onClose, onRetry }: ErrorStepProps) {
  const anyOk = components.some((c) => c.status === "ok");
  return (
    <>
      {globalError && (
        <p className="sw-global-error" role="alert">
          {globalError}
        </p>
      )}
      {components.length > 0 && (
        <ul className="sw-spawn-list" role="list">
          {components.map((c) => (
            <li
              key={c.slot}
              className={`sw-spawn-row sw-spawn-row--${c.status === "ok" ? "ok" : "fail"}`}
            >
              <span
                className={`sw-spawn-dot sw-spawn-dot--${c.status === "ok" ? "ok" : "fail"}`}
                aria-hidden
              />
              <div className="sw-spawn-body">
                <span className="sw-spawn-name">{c.slot}</span>
                {c.error && <span className="sw-spawn-error">{c.error}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="sw-footer sw-footer--split">
        {anyOk ? (
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close (partial)
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
        )}
        <Button variant="primary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </>
  );
}

// ── Stack tree preview (shared by rename + review) ─────────────────

interface StackTreePreviewProps {
  stack: StackBlueprint;
  names: Record<string, string>;
}

function StackTreePreview({ stack, names }: StackTreePreviewProps) {
  const umbrellaSlot = stack.umbrella_slot;
  const umbrella = umbrellaSlot ? stack.components.find((c) => c.slot === umbrellaSlot) : null;
  const others = umbrellaSlot
    ? stack.components.filter((c) => c.slot !== umbrellaSlot)
    : stack.components;

  return (
    <div className="sw-tree" aria-label="Stack structure preview">
      {umbrella && (
        <div className="sw-tree-umbrella">
          <span className="sw-tree-node sw-tree-node--umbrella">
            {names[umbrella.slot] || umbrella.display_name_default}
          </span>
          <span className="sw-tree-node-meta">{umbrella.slot}</span>
        </div>
      )}
      {others.length > 0 && (
        <ul className="sw-tree-children" role="list">
          {others.map((c) => (
            <li key={c.slot} className="sw-tree-child">
              <span className="sw-tree-connector" aria-hidden>
                └
              </span>
              <span className="sw-tree-node">{names[c.slot] || c.display_name_default}</span>
              <span className="sw-tree-node-meta">{c.slot}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Re-export formatRelationship for tests ─────────────────────────
export { formatRelationship };
