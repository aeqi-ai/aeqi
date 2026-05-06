-- Migration 0002: Drop legacy event columns.
--
-- The pre-tool_calls event shape stored ideas to inject as `idea_ids` plus
-- a semantic-search trio (`query_template`, `query_top_k`, `query_tag_filter`).
-- Both shapes coexisted with the canonical `tool_calls` column so older rows
-- could fall through to the legacy path. tool_calls is canonical now —
-- `ideas.assemble({names: [...]})` replaces idea_ids and `ideas.search(...)`
-- replaces the query trio.
--
-- Applied idempotently from `agent_registry::ensure_event_columns` on every
-- aeqi.db open. ALTER TABLE DROP COLUMN requires SQLite 3.35.0+; aeqi bundles
-- SQLite 3.46+ via rusqlite features = ["bundled"], so DROP COLUMN is safe.
ALTER TABLE events DROP COLUMN idea_ids;
ALTER TABLE events DROP COLUMN query_template;
ALTER TABLE events DROP COLUMN query_top_k;
ALTER TABLE events DROP COLUMN query_tag_filter;
