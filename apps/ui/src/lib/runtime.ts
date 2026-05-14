/** Well-known keys on `Quest.metadata`. Server can attach arbitrary
 *  additional keys (the index signature). The two we read in the UI
 *  are explicit so a backend rename surfaces as a TS error rather than
 *  silently stopping a render. */
export interface QuestMetadata {
  /** Mirror of `Quest.runtime` when the runtime field isn't populated
   *  on the wire (some legacy endpoints stuff it under metadata). */
  "aeqi/runtime"?: QuestRuntime;
  /** Outcome rollup emitted when a quest closes — shape mirrors
   *  `QuestOutcome` but lives under metadata for indexable storage. */
  "aeqi/task_outcome"?: {
    kind: string;
    summary: string;
    reason?: string;
    next_action?: string;
  };
  [key: string]: unknown;
}

export type QuestRuntime = {
  session?: {
    phase?: string | null;
    model?: string | null;
  } | null;
  outcome?: {
    status?: string | null;
    summary?: string | null;
    reason?: string | null;
    next_action?: string | null;
    verification?: {
      approved?: boolean | null;
      confidence?: number | null;
      warnings?: string[];
    } | null;
  } | null;
} | null;

const RUNTIME_PHASE_LABELS: Record<string, string> = {
  prime: "Prime",
  frame: "Frame",
  act: "Act",
  verify: "Verify",
  commit: "Commit",
};

const RUNTIME_STATUS_LABELS: Record<string, string> = {
  done: "Done",
  blocked: "Blocked",
  handoff: "Handoff",
  failed: "Failed",
};

export function formatRuntimePhase(phase?: string | null): string | null {
  if (!phase) return null;
  return RUNTIME_PHASE_LABELS[phase] || phase;
}

export function formatRuntimeStatus(status?: string | null): string | null {
  if (!status) return null;
  return RUNTIME_STATUS_LABELS[status] || status;
}

export function summarizeQuestRuntime(
  runtime?: QuestRuntime,
  closedReason?: string | null,
): string | null {
  const reason = runtime?.outcome?.reason?.trim();
  if (reason) return reason;

  const summary = runtime?.outcome?.summary?.trim();
  if (summary) return summary;

  const warning = runtime?.outcome?.verification?.warnings?.find(Boolean)?.trim();
  if (warning) return warning;

  const fallback = closedReason?.trim();
  return fallback || null;
}

export function runtimeLabel(runtime?: QuestRuntime): string | null {
  const phase = formatRuntimePhase(runtime?.session?.phase);
  const status = formatRuntimeStatus(runtime?.outcome?.status);
  const parts = [phase, status].filter(Boolean);
  return parts.length > 0 ? parts.join(" • ") : null;
}

export function extractRuntime(quest: {
  runtime?: QuestRuntime;
  metadata?: QuestMetadata;
}): QuestRuntime | null {
  if (quest.runtime) return quest.runtime;
  return quest.metadata?.["aeqi/runtime"] ?? null;
}

export function extractOutcome(quest: {
  metadata?: QuestMetadata;
}): { kind: string; summary: string; reason?: string; next_action?: string } | null {
  return quest.metadata?.["aeqi/task_outcome"] ?? null;
}
