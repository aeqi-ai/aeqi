import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useInboxStore } from "@/store/inbox";
import { useDaemonStore } from "@/store/daemon";
import InboxToolbar from "@/components/inbox/InboxToolbar";
import InboxList from "@/components/inbox/InboxList";
import InboxDetail from "@/components/inbox/InboxDetail";
import { toInboxRow, DEFAULT_FILTER } from "@/components/inbox/types";
import type { InboxFilterState, InboxRow, InboxSort } from "@/components/inbox/types";

/**
 * `/` — the canonical daily-driver Inbox surface.
 *
 * Two-pane layout: toolbar + time-grouped list (left) + detail/composer (right).
 * Keyboard: j/k traverse, r focus composer, / focus search, Esc clear/unfocus.
 * Real-time pulse on new WS-pushed items. Composer via answerItem (POST).
 */
export default function MeInboxPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Store subscriptions — field-level to avoid selector churn
  const allItems = useInboxStore((s) => s.items);
  const pending = useInboxStore((s) => s.pendingDismissal);
  const answerItem = useInboxStore((s) => s.answerItem);
  const entities = useDaemonStore((s) => s.entities);

  // Convert visible items to client rows
  const rows: InboxRow[] = useMemo(
    () => allItems.filter((i) => !pending.has(i.session_id)).map(toInboxRow),
    [allItems, pending],
  );

  // Track newly-arrived items for the pulse animation
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const prevRowIdsRef = useRef<Set<string>>(new Set(rows.map((r) => r.id)));
  useEffect(() => {
    const currentIds = new Set(rows.map((r) => r.id));
    const arrived = new Set<string>();
    for (const id of currentIds) {
      if (!prevRowIdsRef.current.has(id)) arrived.add(id);
    }
    prevRowIdsRef.current = currentIds;
    if (arrived.size > 0) {
      setNewIds((prev) => new Set([...prev, ...arrived]));
      const t = window.setTimeout(() => {
        setNewIds((prev) => {
          const next = new Set(prev);
          for (const id of arrived) next.delete(id);
          return next;
        });
      }, 800);
      return () => window.clearTimeout(t);
    }
  }, [rows]);

  // Toolbar state
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<InboxFilterState>(DEFAULT_FILTER);
  const [sort, setSort] = useState<InboxSort>("recent");

  const patchFilter = (patch: Partial<InboxFilterState>) =>
    setFilter((prev) => ({ ...prev, ...patch }));

  // Filter + sort pipeline
  const visible = useMemo(() => {
    let result = rows;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (r) => r.from.name.toLowerCase().includes(q) || r.subject.toLowerCase().includes(q),
      );
    }

    if (filter.kind !== "all") {
      result = result.filter((r) => r.kind === filter.kind);
    }

    if (filter.entityId !== null) {
      result = result.filter((r) => r.entity_id === filter.entityId);
    }

    if (filter.unreadOnly) {
      result = result.filter((r) => r.unread);
    }

    if (sort === "unread") {
      result = [...result].sort((a, b) => {
        if (a.unread === b.unread) return 0;
        return a.unread ? -1 : 1;
      });
    } else {
      result = [...result].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    }

    return result;
  }, [rows, search, filter, sort]);

  // Selection — URL-synced via ?id=
  const urlId = searchParams.get("id");
  const [selectedId, setSelectedId] = useState<string | null>(
    urlId && rows.some((r) => r.id === urlId) ? urlId : null,
  );

  // Default-select first row on load or when current selection disappears
  useEffect(() => {
    if (visible.length === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId && visible.some((r) => r.id === selectedId)) return;
    setSelectedId(visible[0].id);
  }, [visible, selectedId]);

  // Sync selection to URL
  useEffect(() => {
    if (selectedId) {
      setSearchParams({ id: selectedId }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  }, [selectedId, setSearchParams]);

  const selectedRow = visible.find((r) => r.id === selectedId) ?? null;

  // Entity options for the filter popover
  const entityOptions = useMemo(
    () => entities.map((e) => ({ id: e.id, name: e.name ?? e.id })),
    [entities],
  );

  // Refs for keyboard focus targets
  const searchRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  // Keyboard shortcuts: j/k traverse, r focus composer, / focus search, Esc
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tgt = e.target as HTMLElement | null;
      const inInput =
        tgt?.tagName === "INPUT" || tgt?.tagName === "TEXTAREA" || tgt?.isContentEditable;

      if (e.key === "/" && !inInput) {
        e.preventDefault();
        e.stopImmediatePropagation();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }

      if (e.key === "Escape") {
        if (inInput) {
          (tgt as HTMLInputElement | HTMLTextAreaElement).blur();
        } else {
          setSelectedId(null);
        }
        return;
      }

      if (inInput) return;

      if (e.key === "j") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("inbox:traverse", { detail: { direction: "next" } }));
      } else if (e.key === "k") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("inbox:traverse", { detail: { direction: "prev" } }));
      } else if (e.key === "r") {
        if (selectedRow?.replyable) {
          e.preventDefault();
          composerRef.current?.focus();
        }
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [selectedRow]);

  useEffect(() => {
    document.title = "inbox · æqi";
  }, []);

  return (
    <div className="inbox-shell">
      {/* Left pane: toolbar + list */}
      <div className="inbox-pane-list">
        <InboxToolbar
          search={search}
          filter={filter}
          sort={sort}
          entityOptions={entityOptions}
          onSearch={setSearch}
          onFilter={patchFilter}
          onSort={setSort}
          searchRef={searchRef}
        />
        <div className="inbox-pane-list-scroll">
          <InboxList
            rows={visible}
            selectedId={selectedId}
            newIds={newIds}
            onSelect={setSelectedId}
          />
        </div>
      </div>

      {/* Right pane: detail + composer */}
      <div className="inbox-pane-detail">
        <InboxDetail row={selectedRow} onAnswer={answerItem} composerRef={composerRef} />
      </div>
    </div>
  );
}
