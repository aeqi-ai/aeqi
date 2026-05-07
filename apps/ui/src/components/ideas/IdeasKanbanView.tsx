import { useMemo, useState } from "react";
import { Button, Tooltip } from "../ui";
import IdeasViewPopover, { type IdeasView } from "./IdeasViewPopover";
import { setIdeaProperties } from "@/api/ideas";
import { useQueryClient } from "@tanstack/react-query";
import { ideaKeys } from "@/queries/keys";
import type { Idea } from "@/lib/types";

/**
 * Tables-in-Ideas Phase 2 — Kanban view.
 *
 * Groups Ideas by `properties.status` (or, if absent, by the first
 * enum-shaped property key found in the visible set). Default columns
 * are `todo / in_progress / done`. Click a card's status pill to step
 * through statuses (Phase 2.0 — drag-and-drop deferred to Phase 2.5
 * per the brief).
 */
export interface IdeasKanbanViewProps {
  agentId: string;
  ideas: Idea[];
  view: IdeasView;
  onViewChange: (next: IdeasView) => void;
  onNew: () => void;
  onOpen: (id: string) => void;
}

const DEFAULT_LANES = ["todo", "in_progress", "done"] as const;
const UNSET_LANE = "(unset)";

type Lane = string;

function ideaProperties(idea: Idea): Record<string, unknown> {
  return (idea.properties ?? {}) as Record<string, unknown>;
}

function lanesForIdeas(ideas: Idea[]): Lane[] {
  const seen = new Set<Lane>();
  for (const idea of ideas) {
    const status = ideaProperties(idea).status;
    if (typeof status === "string" && status.trim() !== "") seen.add(status);
  }
  // Always present default lanes first; append observed extras.
  const ordered: Lane[] = [];
  for (const lane of DEFAULT_LANES) {
    if (seen.has(lane) || ideas.some((i) => ideaProperties(i).status === lane)) {
      ordered.push(lane);
      seen.delete(lane);
    } else if (ordered.length < DEFAULT_LANES.length) {
      // Keep the canonical kanban shape even when a lane is empty.
      ordered.push(lane);
    }
  }
  for (const extra of seen) ordered.push(extra);
  ordered.push(UNSET_LANE);
  return ordered;
}

function nextLaneFor(current: string | undefined, lanes: Lane[]): string | null {
  const concrete = lanes.filter((l) => l !== UNSET_LANE);
  if (concrete.length === 0) return null;
  const idx = current ? concrete.indexOf(current) : -1;
  return concrete[(idx + 1) % concrete.length] ?? null;
}

export default function IdeasKanbanView({
  ideas,
  view,
  onViewChange,
  onNew,
  onOpen,
}: IdeasKanbanViewProps) {
  const queryClient = useQueryClient();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const lanes = useMemo(() => lanesForIdeas(ideas), [ideas]);

  const grouped = useMemo(() => {
    const map = new Map<Lane, Idea[]>();
    for (const lane of lanes) map.set(lane, []);
    for (const idea of ideas) {
      const status = ideaProperties(idea).status;
      const lane =
        typeof status === "string" && status.trim() !== "" && map.has(status) ? status : UNSET_LANE;
      map.get(lane)!.push(idea);
    }
    return map;
  }, [ideas, lanes]);

  async function cycleStatus(idea: Idea) {
    const current = ideaProperties(idea).status;
    const target = nextLaneFor(typeof current === "string" ? current : undefined, lanes);
    if (target === null) return;
    setPendingId(idea.id);
    try {
      await setIdeaProperties(idea.id, { status: target });
      // Invalidate every Idea query — cheap; the view re-derives from
      // the daemon-store hydrate path.
      await queryClient.invalidateQueries({ queryKey: ideaKeys.all });
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="ideas-list-body">
      <div className="ideas-list-toolbar">
        <span className="ideas-toolbar-search ideas-toolbar-search--readonly" aria-hidden>
          {ideas.length} {ideas.length === 1 ? "idea" : "ideas"} · grouped by status
        </span>
        <div className="ideas-toolbar-actions">
          <IdeasViewPopover view={view} onChange={onViewChange} />
          <Tooltip content="New idea (N)">
            <Button variant="primary" size="sm" onClick={onNew}>
              <svg
                width="11"
                height="11"
                viewBox="0 0 13 13"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M6.5 2.5v8M2.5 6.5h8" />
              </svg>
              New
            </Button>
          </Tooltip>
        </div>
      </div>
      <div className="ideas-kanban" role="region" aria-label="Ideas kanban">
        {lanes.map((lane) => {
          const cards = grouped.get(lane) ?? [];
          return (
            <section key={lane} className="ideas-kanban-col" aria-label={`${lane} lane`}>
              <header className="ideas-kanban-col-head">
                <span className="ideas-kanban-col-label">{lane}</span>
                <span className="ideas-kanban-col-count">{cards.length}</span>
              </header>
              <div className="ideas-kanban-cards">
                {cards.length === 0 ? (
                  <div className="ideas-kanban-empty">—</div>
                ) : (
                  cards.map((idea) => {
                    const status = ideaProperties(idea).status;
                    const statusLabel = typeof status === "string" ? status : UNSET_LANE;
                    return (
                      <article
                        key={idea.id}
                        className={`ideas-kanban-card${pendingId === idea.id ? " is-pending" : ""}`}
                      >
                        <button
                          type="button"
                          className="ideas-kanban-card-name"
                          onClick={() => onOpen(idea.id)}
                        >
                          {idea.name}
                        </button>
                        <div className="ideas-kanban-card-meta">
                          <button
                            type="button"
                            className="ideas-kanban-status-pill"
                            disabled={pendingId === idea.id}
                            onClick={() => void cycleStatus(idea)}
                            title="Click to advance status"
                          >
                            {statusLabel}
                          </button>
                          {(idea.tags ?? []).slice(0, 2).map((t) => (
                            <span key={t} className="ideas-tag-chip">
                              {t}
                            </span>
                          ))}
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
