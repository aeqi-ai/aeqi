# Blueprint Flow Audit — Wave 30 Redesign Brief

Date: 2026-05-05
Scope: End-to-end blueprint UX flow audit for category-grouping redesign
Status: Audit complete; no code changes

## Executive Summary

Blueprints are currently displayed as a flat list in the catalog (`/blueprints`) and spawn flow (`/start`). The founder requested grouping by template category (Foundation/Entity/Venture) to improve discoverability and positioning. All 5 current blueprints map cleanly to 3 TRUST template types — the infrastructure is already present in `templateSlug` metadata and the backend `template_slug_for()` resolver. The redesign requires:

1. **UX restructuring** — replace flat grid/list with category-grouped sections
2. **Inclusion statements** — add per-blueprint "what you get" labels (agents, events, etc.)
3. **Routing/navigation** — URL state persistence for selected category filter
4. **Detail page alignment** — ensure category labels carry through the detail view

**No missing blueprints or metadata gaps** — all 5 blueprints are production-ready and fully described.

---

## Current Blueprint Inventory

| Slug | Display Name | Template | Category | Root Agent | Agents | Events | Ideas | Quests | Tags |
|------|--------------|----------|----------|-----------|--------|--------|-------|--------|------|
| `aeqi` | aeqi | `venture` | Venture | aeqi | 1 (Steward) | 2 | 5 | 1 | none |
| `personal-os` | Personal OS | `foundation` | Foundation | Concierge | 0 | 3 | 4 | 2 | none |
| `solo-founder` | Solo Founder | `entity` | Entity | Founder | 1 (Scribe) | 2 | 5 | 2 | none |
| `studio` | Content Studio | `entity` | Entity | Creator | 2 (Curator, Editor) | 3 | 5 | 2 | none |
| `tech-studio` | Tech Studio | `venture` | Venture | Tech Lead | 2 (DevOps, Designer) | 4 | 5 | 2 | none |

**Template Grouping:**
- **Foundation** (1): Personal OS — single-agent operating system for one person
- **Entity** (2): Solo Founder, Content Studio — root-only companies with auxiliary agents
- **Venture** (2): aeqi, Tech Studio — larger organizations with structure and delegation

---

## Current UX Surface Map

### 1. BlueprintsPage.tsx (`/blueprints`)

**Layout:**
- Vertical PageRail on left (Companies / Agents / Events / Quests / Ideas tabs)
- Main content area with toolbar + grid or list view
- Only "Companies" kind is implemented; other kinds show empty-state

**Toolbar:**
- Search field (keyboard shortcut `/`)
- Sort popover (Recently added, Name A→Z, Name Z→A, Complexity)
- Filter popover (tag-based, multi-select OR semantics)
- View toggle (grid/list)
- "+ New company" button (when not in import mode)

**Display:**
- **Grid view** (default): Cards via `BlueprintCard.tsx`
  - Heading: blueprint name
  - Subheading: tagline
  - Meta: `"2 agents · 1 idea · 1 event"` (comma-delimited seed counts, zeros skipped)
  - No categorization visible
  - Cards sorted by query match or selected sort order
  
- **List view**: Minimal rows
  - Name + tagline + same meta counts
  - No visual grouping

**State Persistence:**
- URL params: `?q=<search>&sort=<sort>&tags=<tag1>,<tag2>&view=<view>`
- No category-filter param

### 2. StartPage.tsx (`/start`)

**Purpose:** Zero-state company creation launcher
**Layout:**
- Header: "Start a company" title + subtitle
- Calls `<BlueprintLaunchPicker mode="spawn-company" />`

**Current flow:**
- Click blueprint → navigates to `/blueprints/<slug>` detail page (not shown to user as a dest)
- User then clicks CTA to proceed to setup/onboarding surface

### 3. BlueprintDetailPage.tsx (`/blueprints/:slug[/:section]`)

**Layout:**
- Vertical PageRail on left (Overview / Roles / Agents / Events / Quests / Ideas tabs)
- Right pane: back button + launch CTA + per-section content

**Sections:**
- **Overview**: Tagline + description + tree preview (via `BlueprintTreePreview.tsx`) + seed counts card (via `BlueprintSeedCounts.tsx`)
- **Roles**: Searchable table of `seed_roles` (if present); empty state if none
- **Agents**: Searchable list of `seed_agents`; always includes implicit root agent
- **Events**: Searchable list of `seed_events` with pattern + cooldown + query metadata
- **Quests**: Searchable list of `seed_quests`
- **Ideas**: Searchable list of `seed_ideas` with tags

**No category label visible** — the template mapping is known server-side but not surfaced in the UI.

---

## Data Flow

### Backend (aeqi-platform)

**Source of Truth:**
- `/home/claudedev/aeqi/presets/blueprints/*.json` — compile-time embedded
- Served via `aeqi-platform/src/blueprints.rs` at `/api/blueprints` (catalog) and `/api/blueprints/:slug` (detail)

**Key Functions:**
- `catalog()` — returns array of blueprint summaries (slug, name, tagline, description, root metadata, seed counts)
- `detail(slug)` — returns full blueprint including all seed arrays
- `template_slug_for(blueprint_slug)` — resolves `templateSlug` from the JSON manifest (e.g., `"tech-studio"` → `"venture"`)

**Blueprint JSON Structure:**
```json
{
  "slug": "unique-id",
  "templateSlug": "foundation|entity|venture",
  "name": "Display Name",
  "tagline": "One-liner tagline",
  "description": "Multi-line description",
  "root": {
    "name": "Root Agent Name",
    "model": "deepseek/...",
    "color": "#hexcolor",
    "system_prompt": "..."
  },
  "seed_agents": [...],
  "seed_events": [...],
  "seed_ideas": [...],
  "seed_quests": [...],
  "seed_roles": [...],
  "seed_role_edges": [...]
}
```

### Frontend (apps/ui)

**Blueprint Type** (`src/lib/types.ts`):
```typescript
interface Blueprint {
  slug: string;
  name: string;
  tagline?: string;
  description?: string;
  tags?: string[];
  root?: RootAgentSpec;
  seed_agents?: BlueprintSeedAgent[];
  seed_events?: BlueprintSeedEvent[];
  seed_ideas?: BlueprintSeedIdea[];
  seed_quests?: BlueprintSeedQuest[];
  seed_roles?: BlueprintSeedRole[];
  seed_role_edges?: BlueprintSeedRoleEdge[];
}
```

**Note:** `templateSlug` is NOT currently in the frontend type definition. Server sends it, but frontend doesn't consume it.

**API Calls:**
- `api.getBlueprints()` — returns `{ blueprints: Blueprint[] }`
- `api.getBlueprint(slug)` — returns `{ blueprint: Blueprint }`

### Current Omissions

1. **Frontend type missing `templateSlug`** — the field is embedded in the JSON and sent over the wire, but TypeScript type doesn't declare it. Consumers can't reference it without a type cast.

2. **No category filter in catalog UI** — sort/search/filter work, but no grouping or filtering by template type.

3. **No "category" field in Blueprint JSON** — the mapping exists via `templateSlug` → backend enum, but there's no user-facing category label in the JSON (e.g., `"category": "foundation"`).

---

## Gap Analysis

### 1. Blueprints Missing Category Labels (UX Surface)

**Status:** All blueprints have `templateSlug` metadata, but no visual category label in the catalog.

**Current state:**
- Grid cards show: name, tagline, seed counts
- List rows show: name, tagline, seed counts
- No category badge, section header, or visual grouping

**Wave 30 requirement:**
- Group cards into three sections: Foundation, Entity, Venture
- Add category label to each card (optional: as a subtle pill or text)
- Persist category selection in URL (`?category=venture`)

**Blueprint → Category mapping confirmed:**
- Foundation: Personal OS (1)
- Entity: Solo Founder, Content Studio (2)
- Venture: aeqi, Tech Studio (2)

### 2. "What You Get" Inclusion Statements Missing

**Status:** Meta line shows counts, but no user-readable copy.

**Current copy:** `"2 agents · 1 idea · 1 event"` (technical inventory)

**Wave 30 requirement:**
- Add brief user-facing statement: `"2-person team · smart template · daily digest"` (humanized)
- Keep technical counts as secondary label or tooltip
- Example from Personal OS: could say `"Your daily chief of staff · built-in calendar sync"`

**Data available:** All seed metadata (agents with system_prompts, events with patterns, ideas with content) can be scanned to generate human copy.

### 3. Blueprint Type Not in Frontend Type Definition

**Status:** `templateSlug` is sent by the server but not declared in TypeScript.

**Current state:**
```typescript
interface Blueprint {
  slug: string;
  name: string;
  // ... no templateSlug field
}
```

**Fix required:** Add `templateSlug?: string` to the type definition so consumers (detail page, launch picker) can reference it with proper typing.

### 4. Detail Page Doesn't Surface Category

**Status:** Detail page shows Overview / Roles / Agents / Events / Quests / Ideas sections, but no category label in the header or breadcrumb.

**Wave 30 opportunity:**
- Add category label to the detail page header (e.g., "Venture Blueprint: Tech Studio")
- Use it in the breadcrumb or as a subtitle to clarify positioning

### 5. Import Mode Doesn't Visually Signal Category

**Status:** When blueprints are opened via import (adding seed primitives to an existing agent), the category context is missing.

**Wave 30 opportunity:**
- Show category alongside the blueprint name when in import mode
- This helps users understand "am I importing a small template or a large structured one?"

---

## Current UX Surfaces Inventory

### Landing/Public
- `/blueprints` — flat catalog (grid/list, filterable)
- `/start` — spawn picker (uses `BlueprintLaunchPicker` component)

### Detail
- `/blueprints/:slug` — detail page with sections
- `/blueprints/:slug/agents` (and other sections)

### Import Flow
- `/blueprints?import_into=<agentId>` — catalog in import mode
- `/blueprints/:slug?import_into=<agentId>` — detail in import mode

### Components Involved
- `BlueprintCard.tsx` — individual card (grid view)
- `BlueprintLaunchPicker.tsx` — spawn flow picker
- `BlueprintsPage.tsx` — catalog/listing page
- `BlueprintDetailPage.tsx` — detail view
- `BlueprintTreePreview.tsx` — org chart visualization
- `BlueprintSeedCounts.tsx` — metadata summary card

---

## Wave 30 Redesign Brief (Loose Structure)

### Design Goals
1. **Improved discoverability** — users immediately see how blueprints are categorized (for one person, small team, growing org)
2. **Positioning clarity** — Foundation/Entity/Venture categories reinforce product positioning (personal → company → scalable)
3. **Inclusion clarity** — users know what agents, structure, and cadence they're getting before clicking

### Recommended Changes

#### 1. Blueprint Catalog (`/blueprints`)
- **Section headers** — three collapsible or stacked sections (Foundation, Entity, Venture) above the grid
- **Category label** — subtle pill or text label on each card
- **URL state** — add `?category=venture` param to filter by one or all categories
- **Sort/filter parity** — existing sort/filter/search still works within the grouped view

#### 2. Blueprint Card
- **Add category badge** (optional: muted pill, e.g. `foundation` in a subtle color)
- **Improve meta line** — could replace or augment `"2 agents · 1 event"` with something more human: `"Concierge + 3 daily rituals"` (requires copy generation from seed metadata)
- **Keep counts as secondary detail** — in a tooltip or collapsed section

#### 3. Start Page (`/start`)
- **Reuse grouped catalog** — use the same section structure as `/blueprints`
- **Add introductory copy** — "Foundation for solo work, Entity for small teams, Venture for growing orgs" (can go in header or as contextual labels)

#### 4. Detail Page
- **Add category breadcrumb** — back link now reads "Back to Venture blueprints" or shows category label in header
- **Category in hero** — subtitle mentions the template type: "Venture Blueprint — grow your team"

#### 5. Type Definition
- **Add `templateSlug` to Blueprint interface** — so detail page and launch picker can use it without type casts
- **Optional: add `category` enum** — map templateSlug to a canonical category name (Foundation/Entity/Venture) in the type

### Implementation Notes

**No new blueprint metadata needed.** The `templateSlug` field already exists in all JSON files.

**Categorization is deterministic:**
```
foundation → Personal OS (1 blueprint)
entity → Solo Founder, Content Studio (2 blueprints)
venture → aeqi, Tech Studio (2 blueprints)
```

**Sort behavior:** When grouped by category, internal sort (alpha, recent, complexity) still applies within each group.

**Empty categories:** If a category has 0 blueprints, hide the section header (no dead sections).

**Import mode:** The same grouping applies when blueprints are opened via `?import_into=<agentId>`.

---

## Files to Touch (Wave 30 Implementation Scope)

| Component | Path | Change Type | Note |
|-----------|------|-------------|------|
| Type | `apps/ui/src/lib/types.ts` | Add `templateSlug?: string` to Blueprint interface | No breaking change; optional field |
| Page | `apps/ui/src/pages/BlueprintsPage.tsx` | Add category grouping logic, URL param, section rendering | Core redesign |
| Page | `apps/ui/src/pages/StartPage.tsx` | Use grouped layout or add intro copy | If delegating to `BlueprintLaunchPicker` refactor |
| Component | `apps/ui/src/components/blueprints/BlueprintCard.tsx` | Add category label/pill (optional) | Minor visual enhancement |
| Component | `apps/ui/src/components/blueprints/BlueprintLaunchPicker.tsx` | Likely inherits grouping from catalog refactor | Depends on architecture choice |
| Component | `apps/ui/src/pages/BlueprintDetailPage.tsx` | Add category label to header/breadcrumb | Minor; detail surfacing |
| Styles | `apps/ui/src/styles/blueprints-store.css` | Add `.bp-category-section`, `.bp-category-header`, `.bp-category-pill` classes | Design-system aligned |

---

## Risk Assessment

**Low risk:**
- Adding `templateSlug` to the type definition (optional field, no breaking change)
- URL param addition (existing `?q=&sort=&tags=&view=` parity)
- Category-label surfacing (new CSS classes only, reuses existing card structure)

**Moderate risk:**
- Category grouping logic (requires loop restructuring in `BlueprintsPage.tsx` and possibly `BlueprintLaunchPicker.tsx`)
- Sort behavior inside grouped sections (e.g., does "complexity" sort all 5 blueprints, or just within each category?)

**Mitigation:**
- Define sort scope clearly before implementation (recommended: sort is global, sections are visual grouping only)
- Test import mode thoroughly (category labels should not break the `?import_into=` flow)
- Verify URL state persistence across category toggle and other filters

---

## Success Criteria (Wave 30)

1. ✓ Blueprints grouped into 3 sections (Foundation, Entity, Venture) on `/blueprints`
2. ✓ Category label visible on each blueprint card (pill, text, or visual indicator)
3. ✓ URL persistence for category filter (`?category=venture`)
4. ✓ Category labels carry through detail page
5. ✓ Search/sort/filter still work across or within category groupings (spec choice: global sort wins)
6. ✓ `/start` spawn flow respects grouping (either reuses catalog layout or adds intro copy)
7. ✓ Import mode (`?import_into=...`) works without regression
8. ✓ Smoke test: all 5 blueprints render correctly in both grouped and non-grouped views

---

## Appendix: Blueprint JSON Samples

### aeqi (Venture)
- Root: aeqi (deepseek-v4-pro)
- Agents: Steward
- Events: session_bootstrap, weekly_review
- Ideas: 5 (company purpose, operating principles, capture pattern, daily rhythm, Steward's beat)
- Quests: 1 (decide purpose)
- Positioning: "Flexible company that becomes whatever you need"

### Personal OS (Foundation)
- Root: Concierge (deepseek-v4-pro)
- Agents: none
- Events: session_bootstrap, morning_brief, weekly_review
- Ideas: 4 (identity, preferences, routines, boundaries)
- Quests: 2 (setup and boot)
- Positioning: "One agent that runs your life like a chief of staff"

### Solo Founder (Entity)
- Root: Founder (deepseek-v4-pro)
- Agents: Scribe
- Events: weekly_review, session_bootstrap
- Ideas: 5 (operating principles, shipping log, reflection template, next-week shape, weekly cadence)
- Quests: 2 (setup and bootstrap)
- Positioning: "One builder. One breathing company."

### Content Studio (Entity)
- Root: Creator (deepseek-v4-pro)
- Agents: Curator, Editor
- Events: weekly_review, session_bootstrap, content_grid
- Ideas: 5 (studio identity, workflow, voice, archives, calendar)
- Quests: 2 (setup, 4-week pipeline)
- Positioning: "A three-person creative studio that actually ships"

### Tech Studio (Venture)
- Root: Tech Lead (deepseek-v4-pro)
- Agents: DevOps, Designer
- Events: sprint_planning, weekly_review, incident_on_call, session_bootstrap
- Ideas: 5 (engineering philosophy, architecture docs, deployment checklist, incident protocol, weekly cadence)
- Quests: 2 (setup, first release)
- Positioning: "A small engineering team that ships software, not slides"

---

## Next Steps

1. **Confirm design intent** — is this grouping the right structure for Wave 30, or does the founder have a different shape in mind?
2. **Define sort scope** — should "sort by complexity" apply globally or per-category?
3. **Plan copy generation** — decide on human-readable "what you get" copy (manual per blueprint, or generated from seed metadata?)
4. **Estimate effort** — likely 6-8 hours including tests, styling, and detail-page alignment
5. **Schedule** — tentative placement in Wave 30 roadmap

---

**End of Audit**
