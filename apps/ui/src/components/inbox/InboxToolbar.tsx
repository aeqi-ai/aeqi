import InboxFilterPopover from "./InboxFilterPopover";
import InboxSortPopover from "./InboxSortPopover";
import type { InboxFilterState, InboxSort } from "./types";

export interface InboxToolbarProps {
  search: string;
  filter: InboxFilterState;
  sort: InboxSort;
  entityOptions: { id: string; name: string }[];
  onSearch: (q: string) => void;
  onFilter: (patch: Partial<InboxFilterState>) => void;
  onSort: (s: InboxSort) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}

export default function InboxToolbar({
  search,
  filter,
  sort,
  entityOptions,
  onSearch,
  onFilter,
  onSort,
  searchRef,
}: InboxToolbarProps) {
  return (
    <div className="ideas-list-head inbox-head">
      <div className="ideas-toolbar">
        {/* Search */}
        <span className="ideas-list-search-field">
          <svg
            className="ideas-list-search-glyph"
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            aria-hidden
          >
            <circle cx="5.2" cy="5.2" r="3.2" />
            <path d="M7.6 7.6 L10 10" />
          </svg>
          <input
            ref={searchRef}
            className="ideas-list-search"
            type="text"
            placeholder="Search inbox"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                if (search) {
                  onSearch("");
                } else {
                  (e.target as HTMLInputElement).blur();
                }
              }
            }}
          />
          {!search && (
            <kbd className="ideas-list-search-kbd" aria-hidden>
              /
            </kbd>
          )}
          {search && (
            <button
              type="button"
              className="ideas-list-search-clear"
              onClick={() => onSearch("")}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </span>

        {/* Sort */}
        <InboxSortPopover sort={sort} onChange={onSort} />

        {/* Filter */}
        <InboxFilterPopover filter={filter} entityOptions={entityOptions} onChange={onFilter} />
      </div>
    </div>
  );
}
