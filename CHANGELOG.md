# Changelog

All notable changes to aeqi are documented here. The format is loosely based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows
[Semantic Versioning](https://semver.org/) on the workspace `version` field.

Per-release detail (full commit list, contributors, artifacts) lives at
[github.com/aeqi-ai/aeqi/releases](https://github.com/aeqi-ai/aeqi/releases).

## [0.15.0] — 2026-05-04

The pre-launch hardening release. v0.14.0 is unsuitable for charging strangers;
v0.15.0 is. Anyone running `curl -fsSL …/releases/latest/download/aeqi-linux-amd64`
should pull this build before provisioning new tenants.

### Critical fixes

- **fix(boot): credential migration tolerates fresh tenant DBs.** The runtime's
  `channel_credential_migration` walker queried `channels` before
  `AgentRegistry::open` had created the table on a fresh DB, putting new
  containers / VPS into a permanent crashloop (counter hit 45,000+ in the
  2026-04-29 sandbox-launch incident). The walker now probes `sqlite_master`
  and returns `(0, 0)` when the table doesn't exist yet. **This single fix is
  why v0.14.0 cannot be safely deployed to new tenants.**

### Role primitive — shipped

- New WHO primitive: `Role` with `role_type` (director / operational / advisor)
  + `founder` flag + grants set. Org chart = roles + role_edges DAG; authority
  is transitive closure.
- Six-grant catalog: `roles.manage`, `agents.spawn`, `agents.configure`,
  `treasury.read`, `governance.read`, `settings.modify`.
- Role invitation flow end-to-end: invite by email or company-slug → email +
  in-app accept page → signup-with-invitation → role occupant set.
- Auto-Director on Company spawn: every Blueprint creates the founding
  Director role with the creator as occupant + all six grants + `founder=1`.

### Stripe restructure

- Single Product (`Company`) at $19 first-month → $49/mo, runs as one $49 Price
  + auto-applied first-month coupon (`AEQI_FIRST_MONTH`, -$30, duration:once).
  Replaces the dual-product founder-fee + monthly setup. One cart line, clean
  MRR, clean cancellation.
- USDC rail (Phase A): SIWE users only, $19 first-month → $45/mo (Stripe fee
  passed through), monthly platform-side cron pull from external EOA.
- Inference credit denominated in dollars ($25/mo any model) instead of token
  budget. Top up via card or USDC. External callers pay per-call via x402
  (cost + 20%).

### Reliability — webhook + signup

- Stripe webhook event-id deduplication (`stripe_processed_events` PK on
  `event_id`). Closes the gap where Stripe's redelivery semantics caused
  every state change to re-fire on retry — most consequentially re-spawning
  VPS provisioning on `checkout.session.completed` replay.
- Webhook signature verification + idempotency covered by 8 unit tests
  (HMAC-SHA256 round-trip, wrong secret, tampered payload, stale timestamp,
  missing signature components, idempotency reject-replay, independent ids).
- `customer.subscription.created` auto-spawns the user's personal Company on
  first paid activation if no placement exists yet — closes the
  paid-but-never-returned-to-/start hole. Idempotent: gated on
  `get_user_agents().is_empty()`.
- BillingPanel post-Stripe handler stops calling `/blueprints/spawn` (which
  required X-Entity it didn't have); polls for the entity to appear via
  `useEntities()` then redirects to `/c/{id}/inbox`.

### Company shell — Phase 1

- `Overview · Roles · Ownership · Treasury · Governance · Settings` rail
  locked.
- **Ownership** Phase 1: founder → director → operational → advisor pivot
  with grant counts. On-chain TRUST mirror appears as supplementary section
  when the Solana bridge is enabled.
- **Treasury** Phase 1: per-Company Stripe state (plan, status, next charge,
  card last4) + resource pack + Manage-billing CTA. On-chain cap table
  appears as supplementary section.
- **Governance** Phase 1: grant-catalog view showing which roles hold each
  grant. Click-through to role detail.
- Portfolio page retired; Treasury is the canonical financial surface (both
  per-Company at `/c/{id}/treasury` and personal at `/me/treasury`).
- Sidebar `CompanySwitcher` ships: personal-scope Inbox + every owned
  Company + "Start a new company" CTA, click-to-pivot.

### Onboarding

- Blueprints now declare `seed_inbox_message`: every Company spawn populates
  the inbox with a tailored greeting from the root agent, awaiting reply.
  No more empty-inbox first-impression on signup.
- Five surviving Blueprints: `aeqi`, `solo-founder`, `studio`, `tech-studio`,
  `personal-os`. All on deepseek-v4-flash by default.
- Default model switched from anthropic/{haiku,sonnet,opus} → DeepSeek V4
  Flash (`deepseek/deepseek-v4-flash`) for cost.

### Admin / ops

- `/api/admin/vps/spawn-test` (x-admin-key gated) — provision a Hetzner VPS
  for a chosen entity_id without going through Stripe. Mirrors the production
  webhook code path so the operator can exercise provisioning before flipping
  a real charge.
- `/api/admin/users`, `/api/admin/placements`, `/api/admin/invite-codes`,
  `/api/admin/waitlist` — fleet inspection for the operator.
- Hetzner server type bump: `cx22 → cx23`, `cx32 → cx33` after Hetzner
  deprecated the older line. Same shape, current SKUs.
- Smoke-prod cron + Resend alerting (every 15 min): probes `/api/health`,
  landing HTML, public `invite-check`, authed `/me`, admin overview.
  Pages on first failure with 30-min dedup.
- `_mint-jwt.mjs` headless JWT minter for ops smokes.

### Personal Company (architecture)

- Every user has a personal 1-owner Company Entity. Decided 2026-05-03;
  auto-spawn implementation shipped via `customer.subscription.created`
  webhook (NOT in `signup_handler` — there's no free tier, the Company can
  only exist after payment).

### Upgrade path

- Workspace version bumped 0.14.0 → 0.15.0.
- No DB migrations break v0.14.0 callers; `stripe_processed_events`,
  per-Company billing columns, role_grants table all idempotent on existing
  databases.

## [0.14.0] — 2026-04-28

- **Entity** is now a first-class primitive in the runtime (Phase A) — distinct
  identity surface from agents, distinct routing, distinct persistence.
- Sidebar refactor: roots → entities; LeftSidebar silhouette with brand header,
  collapsible groups, top-level Inbox + Economy, ink-treatment account row.
- Quests: unified compose + view on a single `QuestCanvas`; ideas-list tag
  groups share the canonical collapsible group-head.
- Toolbar grammar locked across Quests + Ideas (search · sort · filter · view ·
  +); URL-persisted view + sort.
- Design system: `.impeccable.md` wired into the UI agent constitution so every
  session loads the design rules; portal-rendered popovers escape column
  overflow; tag-grouped headings render canonical chip pills.
- Deploy: post-deploy smoke checks now exercise authed endpoints (`/api/entities`,
  `/api/billing/overview`, `/api/agents` with `X-Entity`) and assert
  entities ↔ billing parity. Catches the bug class where prod 400s every
  authed request while deploy reports "successful".
- OSS readiness: rewritten outward-facing SECURITY.md, CONTRIBUTING.md,
  CODE_OF_CONDUCT-friendly tone; CHANGELOG.md adopted; `.gitleaks.toml`
  allowlist for test PEM fixtures; orphaned `.githooks/pre-commit`,
  `ARCHITECTURE.md`, internal strategy docs, and 4 unpublished blog drafts
  dropped from the tree.

## [0.13.0] — 2026-04-25

- Add `aeqi-pack-slack` (Channels / Messages / Reactions / Users / Search) and
  `aeqi-pack-notion` (Pages / Databases / Blocks / Users) on the OAuth2 lifecycle.
- Inbox: ink-panel treatment for `question.ask` in chat; chat-reply clears
  awaiting state.
- Runtime: `ban_after_wrong` dial + denormalised `wrong_feedback_count`; cap
  wiring for tag policies.
- Hermes micro-absorptions: `max_result_chars`, completion guards.
- Prompt-cache discipline via frozen-snapshot pattern; cache breakpoints driven
  by tag policies.
- Inbox capability + ACL coherence pass; sharper `question.ask` discipline.

## [0.12.1] — 2026-04-25

- Destructive credential migration onto the credential substrate (T1.9.1).
- Director Inbox at `/` via the `question.ask` tool.

## [0.12.0] — 2026-04-25

- Add `aeqi-pack-google-workspace` (Gmail / Calendar / Meet) and
  `aeqi-pack-github` (Issues / PRs / Files / Releases / Search) packs on the
  OAuth2 / GitHub-App lifecycles.
- Wire MCP client integration into the daemon and session manager (T1.10).
- UI: integrations panel — typed API client, IntegrationCard,
  ConnectIntegrationModal, status pill primitive.

## [0.10.0] — 2026-04-25

- Collapse the connection vocab to a `mention / embed / link` substrate (3
  relations, cross-type edges).
- `sessions.search` via FTS5 over message transcripts; shared `sqlite::fts`
  helpers extracted.

## [0.9.0] — 2026-04-25

- TagPolicy gains three optional dials: blast-radius, dedup window, supersession
  default (T1.1).
- `event_invocations` records `outcome_score` and `outcome_details` (T1.2).
- `meta:placeholder-providers` resolver (T1.3) and per-item validator hook on
  `ideas.store_many` (T1.4).
- Reflection: `session:quest_end` dispatched from every terminal path (IPC
  close, LLM tool-close, queue-finalize); refresh stale event tool_calls.
- Providers: route around SiliconFlow's silent-empty bug for deepseek-v3.2.

## [0.8.0] — 2026-04-24

- Session refactor: delete `SessionType::Perpetual` and the parking loop. Every
  execution is ephemeral — one turn per spawn.
- Route web `session_send` through the `pending_messages` rail.
- Step-boundary user-message injection.
- `AgentConfig::can_self_delegate` + `session.spawn` gate.
- UI: `Combobox` and `Popover` primitives; migrate raw `<select>` callsites.

## [0.7.0] — 2026-04-20

- Truthful per-step `EventFired` emission and `session:stopped` seed event.
- Lifecycle correctness pass and second-release polish.
- UI: design-token convergence with landing (paper/card/ink); profile row in
  sidebar footer; path-based favicon.

## [0.6.0] — 2026-04-19

- **Tool-calls unification.** Events are now `pattern + tool_calls`. Single
  `ToolRegistry` for LLM-fired and event-fired calls with a `CallerKind`
  (LLM / Event / System) ACL.
- **Compaction-as-delegation.** `context:budget:exceeded` fires `session.spawn`
  + `transcript.replace_middle`. Inline compaction pipeline becomes the
  fallback when no `PatternDispatcher` is present.
- **Middleware → detectors.** Detectors fire patterns
  (`loop:detected`, `guardrail:violation`, `graph_guardrail:high_impact`,
  `shell:command_failed`); events own the response. `DEFAULT_HANDLERS`
  preserves old behavior as a fallback.
- Validate event `tool_calls` arguments against tool input schemas at save
  time.
- Event invocation trace log; lifecycle + middleware seed events.
- Persistent root agent picker in the left sidebar.

## [0.5.0] — 2026-04-11

- Unified prompt system; connection pooling; production hardening.
- Tool taxonomy: `agents_`, `quests_`, `events_`, `insights_`, `prompts_`.
- Chat refactor: precision-instrument composer, message queue during streaming,
  per-step turn separators, full-width tool content.

## [0.2.0] — 2026-04-08

- First public-tagged release. Daemon, ideas store with FTS5, quest DAG,
  middleware chain, OpenRouter / Anthropic / Ollama providers, web UI shell.
