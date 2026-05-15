import { useMemo, useState } from "react";
import type { Idea, Quest } from "@/lib/types";
import { Button, CardTrigger, Popover } from "../ui";

// ─────────────────────────────────────────────────────────────────────
//  LinkedIdeaPicker — compose-only. The trigger reads the pinned idea's
//  name (or "New idea") with a chevron; the popover hosts a search +
//  list with per-idea quest counts. Detach falls back to fresh-compose.
// ─────────────────────────────────────────────────────────────────────
export default function LinkedIdeaPicker({
  ideas,
  quests,
  pinnedIdea,
  onPick,
  onUnpin,
}: {
  ideas: Idea[];
  quests: Quest[];
  pinnedIdea: Idea | null;
  onPick: (idea: Idea) => void;
  onUnpin: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const questCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const q of quests) {
      if (q.idea_id) counts.set(q.idea_id, (counts.get(q.idea_id) ?? 0) + 1);
    }
    return counts;
  }, [quests]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? ideas.filter((i) => i.name.toLowerCase().includes(q)) : ideas;
    return list.slice(0, 12);
  }, [ideas, query]);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      trigger={
        <Button
          variant="secondary"
          size="sm"
          className={`quest-compose-link${pinnedIdea ? " is-pinned" : ""}${open ? " open" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          title={pinnedIdea ? `Linked idea: ${pinnedIdea.name}` : "Composing a new idea"}
          trailingIconMode="inline"
          trailingIcon={
            <svg
              className="quest-compose-link-chevron"
              width="9"
              height="9"
              viewBox="0 0 9 9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M2 3.5 L4.5 6 L7 3.5" />
            </svg>
          }
        >
          {pinnedIdea && <span className="quest-compose-link-prefix">Idea ·</span>}
          <span className="quest-compose-link-label">
            {pinnedIdea ? pinnedIdea.name : "New idea"}
          </span>
        </Button>
      }
    >
      <div className="quest-compose-picker" role="dialog" aria-label="Pick a linked idea">
        <input
          type="search"
          className="quest-compose-picker-search"
          placeholder="Search ideas…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <div className="quest-compose-picker-list">
          {filtered.length === 0 && (
            <div className="quest-compose-picker-empty">No matching ideas.</div>
          )}
          {filtered.map((idea) => {
            const count = questCounts.get(idea.id) ?? 0;
            const isPinned = pinnedIdea?.id === idea.id;
            return (
              <CardTrigger
                key={idea.id}
                className={`quest-compose-picker-row${isPinned ? " is-active" : ""}`}
                onClick={() => {
                  onPick(idea);
                  setOpen(false);
                  setQuery("");
                }}
                aria-label={`Select idea: ${idea.name}`}
              >
                <span className="quest-compose-picker-name">{idea.name}</span>
                {count > 0 && (
                  <span className="quest-compose-picker-meta">
                    · {count} quest{count === 1 ? "" : "s"}
                  </span>
                )}
              </CardTrigger>
            );
          })}
        </div>
        <div className="quest-compose-picker-foot">
          {pinnedIdea ? (
            <button
              type="button"
              className="quest-compose-picker-foot-btn"
              onClick={() => {
                onUnpin();
                setOpen(false);
                setQuery("");
              }}
            >
              Detach idea — compose new
            </button>
          ) : (
            <span className="quest-compose-picker-foot-hint">
              Type below to compose a fresh idea, or pick an existing one above.
            </span>
          )}
        </div>
      </div>
    </Popover>
  );
}
