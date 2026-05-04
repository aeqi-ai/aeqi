# Changelog

Convention: [Keep a Changelog](https://keepachangelog.com/) lite. The indexer
is pre-v1; phases below were shipped autonomously in one session via /loop
heartbeat (TICK numbers reference per-tick entries in
[`indexer-build-log.md`](indexer-build-log.md)).

---

## [unreleased / indexer-build branch] — 2026-05-04

### Phase 18-C — Worktree signpost (TICK 36)
- **Added** `INDEXER.md` at worktree root. README.md is shared with
  main aeqi project; INDEXER.md is the indexer-specific 40-line pointer.

### Phase 17-B — Sanity + freeze pass (TICK 35)
- **Verified** clean cargo build (42s on cleared cache), 33/33 tests, zero
  clippy warnings.
- **Fixed** 6 stale spots in HANDOFF.md surfaced by cold-read: tick count,
  schema migration count (12→30), GraphQL query count (12→25), decode.rs
  file comment, repo layout test-contracts tree, deploy-blocker status
  flipped from "still open" to "RESOLVED in Phase 7-C".

### Phase 16-B — Fund module (TICK 33)
- **Added** `fund_navs`, `fund_flows`, `fund_positions`,
  `fund_position_interactions` tables (4 migrations: 027–030).
- **Indexed** 7 events: NavProcessed, Flow{Requested,Claimed,Cancelled},
  Position{Opened,Closed,Interacted}.
- **Added** `fundNavs`, `fundFlows`, `fundPositions`,
  `fundPositionInteractions` GraphQL queries.
- **Live-tested** with `MockFund.emitFundCycle` (6 events / 1 tx): NAV
  checkpoint + claimed flow + closed position with proceeds.

### Phase 15-E — 100% Factory event coverage (TICK 31)
- **Added** `factory_config` snapshot table (migration 026); UPSERT pattern
  preserves the unset column so partial config events compose.
- **Indexed** Factory_FactoryConfigSet + Factory_PartnerProfileSet.
- **Added** `factoryConfig` query.
- **Verified** on real Factory: deploy script's setFactoryConfig at block
  3548 returns beacon address.

### Phase 14-B — Budget module (TICK 29)
- **Added** `budgets` + `budget_movements` tables (migrations 024–025).
- **Indexed** 6 events: BudgetCreated/Frozen/Unfrozen/Removed lifecycle +
  BudgetDeposited/Consumed money movements.
- **Added** `budgetsForModule` + `budgetMovements` queries.
- **Live-tested** lifecycle: Created → Deposit (1M) → 2× Consume (100k)
  → Frozen, all 5 events in one tx.

### Phase 14-A — Funding module (TICK 28)
- **Added** `fundings` + `funding_exits` tables (migrations 022–023).
- **Indexed** 5 events: Funding lifecycle (Created/Activated/Finalized/
  Removed) + ExitExecuted audit.
- **Added** `fundingsForModule` + `fundingExits` queries.

### Phase 12-C — Factory admin audit log (TICK 26)
- **Added** `factory_admin_events` table (migration 021).
- **Indexed** AdminsAdded + AdminsRemoved (array events expand to one row
  per admin).
- **Added** `factoryAdminEvents` query.
- **Verified** on real Factory: factory.initialize() admin grant indexed.

### Phase 11 — `trusts` schema v2: cross-block multi-sig metadata (TICK 25)
- **Migration 020**: destructive recreate of `trusts` with PK `(trust_id)`,
  `address` `UNIQUE` NULLable, all Created/Registered fields nullable.
- **Refactored** `insert_trust_created` and `update_trust_registered` to
  UPSERT on `trust_id` — either order yields a complete row.
- **Added** `trustById(trustId)` query for pre-create lookups.
- **Verified** historical multi-sig flow now returns full trust metadata
  including Registered fields that fired in tx N before Created in tx N+1.
- **Hardened** `store::open` with `PRAGMA foreign_keys = OFF` after
  schema-recreate triggered SQLite "foreign key mismatch" at commit time.

### Phase 10-B — Multi-sig approval + `trust_signers` schema v2 (TICK 24)
- **Indexed** Factory_TRUSTApprovedEvent (multi-sig approval event).
- **Migration 019**: destructive recreate of `trust_signers` with PK
  `(trust_id, signer_address)`, `trust_address` NULLable backfilled by
  TrustCreated handler.
- **Verified** on real `CreateMultiSigTrust.s.sol` flow: SignerAdded in tx
  N (registration), TrustCreated in tx N+1 (approval) → both signers
  visible with `hasSigned: true`, addresses backfilled.

### Phase 10-A — Templates + demo runbook (TICK 23)
- **Added** `templates` table (migration 018) + Factory_TemplateReplaced
  handler with `replace_count` increment semantics.
- **Added** `templatesForFactory` query.
- **Added** "Live demo against real aeqi-core" recipe to HANDOFF.md.

### Phase 9 — Intra-block subscription lag CLOSED (TICK 22)
- **Refactored** `chain::poll::run` to loop within each block: re-read
  `watched_addresses` after each fetch + delta-fetch logs from newly
  registered addresses until none added.
- **Verified** on real `registerTRUST` tx: 6 events in one block
  (TRUSTCreated + Registered + 2 SignerAdded + 3 TRUST_ModuleAdded for
  factory + role + token). Last architectural correctness gap closed.

### Phase 8 — Real-contracts loop CLOSED + intra-block ordering fix (TICK 21)
- **Wrote** `CreateTrust.s.sol` in sister `aeqi-core-deploy-fix` worktree
  with `TestConfigs`-encoded value configs that role + token modules
  need to initialize.
- **Indexed** real `registerTRUST` end-to-end: full TRUST with template,
  ipfsCid, signersCount=1, valueConfigsCount=2, signer attributed.
- **Fixed** intra-fetch ordering bug: real flow emits SignerAdded →
  Registered → Created in one tx; sort logs within each block by topic0
  priority (Created → Registered → others) before dispatch.

### Phase 7-C — aeqi-core deploy fix: original blocker RESOLVED (TICK 20)
- **In sister worktree** `~/projects/aeqi-core-deploy-fix` on branch
  `deploy-fix-2026-05-04`: rewrote `Deploy.s.sol` for new Beacon ctor
  (`defaultDelegatedSource` arg), zero-arg `Factory.initialize()`,
  `Factory.replaceImplementations(...)` for module impls (gated by
  `onlySourceOwner` on Beacon).
- **Verified** ONCHAIN EXECUTION COMPLETE on Anvil: Factory + Beacon +
  TRUST impl + 8 module impls all deployed and registered.

### Phase 6-B — Vesting module (TICK 19)
- **Added** `vesting_positions` + `vesting_contributions` +
  `vesting_claims` tables (migrations 015–017).
- **Indexed** 5 Vesting events: position lifecycle (Created/Activated/
  Removed) + Contributed + Claimed audit logs.
- **Added** `vestingPositions` + `vestingContributions` + `vestingClaims`
  queries.

### Phase 6-A — Token module (TICK 18)
- **Added** `token_balances` + `token_transfers` tables (migrations
  013–014). Atomic balance update inside SQLite tx using alloy U256
  arithmetic; replay-safe via `INSERT OR IGNORE` on log coord.
- **Indexed** ERC20 Transfer (mint/burn via zero address).
- **Added** `tokenHolders` (cap-table) + `tokenTransfers` queries.
- **Live-tested** mint 1M → transfer 100k → burn 50k:
  founder=850k, employee=100k. Math correct through TEXT/U256 round-trip.

### Phase 5 — HANDOFF.md (TICK 17)
- **Wrote** initial `docs/HANDOFF.md` (~340 lines): boot recipe, schema,
  GraphQL, architecture, test contracts, apps/ui integration, open work,
  "how to add a new event type" recipe.

### Phase 4-C — Governance module (TICK 16)
- **Added** `proposals` + `votes` tables (migrations 011–012).
- **Indexed** 5 Governance events: ProposalCreated/Canceled/Succeeded/
  Executed status lifecycle + VoteCast (OZ Bravo support convention 0/1/2).
- **Added** `proposalsForModule` + `votesForProposal` queries.
- **Live-tested** with `emitFullProposalLifecycle` (5 events / 1 tx):
  proposal status transitions Created → Succeeded → Executed in-block;
  both votes attributed.

### Phase 4-B — Role module (TICK 15)
- **Added** `roles` + `role_assignments` tables (migrations 009–010).
- **Indexed** 5 Role events: RoleCreated + assignment audit log
  (Assigned/Resigned/Removed/Transferred). Transferred splits to two
  audit rows (transferred_from + transferred_to) sharing log_index.
- **Added** `rolesForModule` + `roleAssignments` queries.
- **Verified** 3-LEVEL DYNAMIC DISPATCH: Factory → trust → module →
  Role events all caught from one cast send chain.

### Phase 4-A — TRUST permissions audit log (TICK 14)
- **Added** `permissions_events` table (migration 008).
- **Indexed** 3 TRUST events: PermissionsGranted/Revoked/Set.
- **Added** `permissionsEvents` query.
- **Architectural lesson**: alloy's `decode_log` validates topic0 — each
  dispatch arm must use its OWN sol! type, even when variants share the
  on-wire shape.

### Phase 3 — Multi-address dispatch via watched_addresses (TICK 13)
- **Added** `watched_addresses` + `modules` tables (migrations 006–007).
- **Refactored** poll loop: each round SELECTs all watched addresses and
  builds one Filter spanning them; handlers self-register new addresses
  (TrustCreated → trust, ModuleAdded → module).
- **Indexed** TRUST_ModuleAdded — first per-trust event.
- The architectural cliff: indexer now follows the deploy graph
  dynamically across 3 levels of contract creation.

### Phase 2 — Full Factory event coverage (TICK 12)
- **Indexed** Factory_TRUSTRegisteredEvent + Factory_TRUSTSignerAdded
  alongside the existing Created handler. Topic0 dispatch across all 3.
- **Added** `trust_signers` table (migration 005) + `trustSigners` query.

### Phase 1.5 — End-to-end proof point (TICK 11)
- **Wrote** `MockFactory.sol` emitting Factory_TRUSTCreatedEvent.
- **Verified** REAL on-chain event flow: Anvil → alloy poll → topic0
  filter → sol! decode → SQLite insert → GraphQL returns the trust row.

### Phase 1 — Poll loop + reorg tracking (TICK 9–10)
- **Added** `committed_blocks` table (migration 002), `commit_block` /
  `unwind_above` / `highest_committed` helpers.
- **Wrote** alloy HTTP provider + poll loop with confirmation depth
  (12 blocks default), per-block log fetching, parent_hash chain
  validation for reorg detection.

### Phase 0 — Scaffold + decode + GraphQL Hello World (TICK 1–8)
- **Created** `crates/aeqi-indexer/` Cargo crate (alloy v1, async-graphql v7,
  rusqlite, axum).
- **Vendored** ABIs from `~/projects/aeqi-graph/abis/`.
- **Wrote** sol! Factory contract block in decode.rs.
- **Added** initial migrations 001–004: schema_migrations, committed_blocks,
  accounts, trusts.
- **Wired** GraphQL `trust(address)` query + `/healthz` + GraphiQL playground.

---

## Architectural milestones (timeline)

| Date | Phase | Milestone |
|---|---|---|
| 2026-05-04 | 0 → 1.5 | First real on-chain event indexed end-to-end |
| 2026-05-04 | 3 | Multi-address dispatch (3-level dynamic subscription) |
| 2026-05-04 | 7-C | Sister-worktree fix unblocks real aeqi-core deploy |
| 2026-05-04 | 8 | Real `registerTRUST` indexed end-to-end |
| 2026-05-04 | 9 | Intra-block multi-level cascade closed (last correctness gap) |
| 2026-05-04 | 10-B → 11 | Cross-block multi-sig flow indexed via schema v2 |
| 2026-05-04 | 16-B | Last meaningful module port (Fund) — 10 contract types |

---

## Out of scope (deferred indefinitely)

- **Foundation module** — pure scaffolding ABI, no domain events worth indexing.
- **Unifutures + UnifuturesPositionManager** — derivative-position niche.
- **Uniswap + UniswapPositionManager** — DEX integration niche.
- **Production hardening** — WSS log subscription, multi-chain (`chain_id`
  column), eth_call backfill, Prometheus metrics, systemd unit. See
  HANDOFF.md "Production-readiness checklist" — none required for v1 demo.
- **apps/ui glue** — needs interactive design input; deferred to user session.
