# Indexer Build Log — autonomous session

**Started:** 2026-05-04
**Authorization:** founder-approved 8h autonomous build with /loop heartbeat
**Self-paced:** I own decisions. I do not ask the user. I document trade-offs in this log.

## North star (the deep goal)

The user wants the v2 vision: real on-chain Company creation with Blueprint → DAO deploy → user-as-director → governance transition → indexed → mirrored into apps/ui → end-to-end functional. Account abstraction with paymaster (we cover gas via Stripe revenue). Agents hold roles via embedded wallets. Company switcher = role/route picker. Self-host = own indexer.

**That's 6+ months of work. I have ~8 hours.**

The honest path I'm taking: **maximum progress on the highest-leverage chain** that gets us closer to v2. That chain is:

```
local Anvil + aeqi-core deployed
  → indexer reads events
    → schema in Postgres
      → GraphQL API
        → apps/ui can query (later phase)
          → end-to-end Company creation flow
            → governance + roles + agents + accounts (later phases)
```

Every tick I move ONE link forward. I don't try to ship the whole chain at once.

## Current state (UPDATED EVERY TICK)

```
TICK: 10 (PHASE 1 ✓ COMPLETE — POLL LOOP LIVE)
PHASE: 1 ✓ COMPLETE | 12/12 tests green | live poll loop indexed 766 Anvil blocks
        | next: Phase 2 (more entity schemas + write a minimal MockFactory.sol to test event decoding)
LAST ACTION (TICK 7+8):
  TICK 7 — wrote crates/aeqi-indexer/src/api.rs (async-graphql Schema + axum router):
    - Trust GraphQL type with all fields from store::TrustRow
    - Query: trust(address) -> Option<Trust>, trustsCount, version
    - GraphiQL playground at GET /graphql
    - POST /graphql for queries
    - GET /healthz returns "ok"
    - Test: graphql_returns_indexed_trust ✓
  TICK 8 — wired main.rs, ran live binary:
    - 5 migrations applied to fresh SQLite
    - GraphQL server boots on :8500 in ~1s
    - curl /healthz → "ok"
    - curl POST /graphql with `{ version trustsCount }` → {"data":{"version":"0.14.0","trustsCount":0}}
    - All 5 tests pass: decode round-trip, sig hash, migration idempotency, store round-trip, graphql query

PHASE 0 COMPLETE. Indexer is a working Rust HTTP service that:
  - Persists indexed events to SQLite
  - Exposes them via GraphQL
  - Decodes Factory event types (alloy sol! generated)
  - Has reorg-tracking schema in place (committed_blocks)
  - Idempotent migrations

TICK 9 — PHASE 1 reorg + provider:
  Wrote chain.rs:
    - commit_block(block_number, block_hash, parent_hash) → returns continuous?
    - unwind_above(safe_block) → unwinds committed_blocks above safe point
    - highest_committed() → lookup resume point
    - provider::http_provider(rpc_url) → alloy HTTP provider
    - provider::latest_block() → sanity check
  Tests added (6 new):
    - commit_continuous_blocks_reports_true ✓
    - commit_with_wrong_parent_reports_false ✓ (reorg detection)
    - commit_with_skipped_block_reports_false ✓ (gap detection)
    - unwind_clears_blocks_above_safe ✓
    - highest_committed_works ✓
    - provider_connects_to_anvil_if_running ✓ LIVE — confirmed alloy talks to running Anvil
  Total: 11/11 tests pass

TICK 10 — PHASE 1 COMPLETE (poll loop LIVE):
  Wrote chain::poll module:
    - PollConfig struct (rpc_url, factory_address, start_block, confirmation_depth, poll_interval)
    - poll::run(cfg, db) async loop:
      * resume from highest_committed + 1 OR start_block
      * fetch blocks up to head - confirmation_depth (12)
      * cap at 100 blocks/round
      * for each block: fetch logs filtered to factory + Factory_TRUSTCreatedEvent topic0
      * decode via alloy sol_types
      * insert_trust_created on success
      * commit_block (reorg-safe — unwind on parent_hash mismatch)
  Wired poll loop into main.rs:
    - tokio::spawn alongside api::serve
    - reads AEQI_INDEXER_RPC + AEQI_INDEXER_FACTORY + AEQI_INDEXER_START_BLOCK env
    - poll_handle.abort() if serve exits
  LIVE SMOKE TEST:
    - Anvil at block ~778 when test started
    - Indexer started fresh (no DB), poll loop began at start_block=0
    - In ~6 seconds: indexed blocks 0→757 (758 committed_blocks rows)
    - GraphQL still responsive on 8501 (concurrent serving + polling works)
    - factory=None means no log decoding ran (smoke mode), but block tracking + commit_block end-to-end VERIFIED
    - When killed: 766 committed_blocks total — proves continuous indexing from cold start

12/12 tests green. Phase 1 done (real chain integration).
PIVOT (locked TICK 5): Build indexer against ABIs first; live deploy is separate problem.
NEXT ACTION (Phase 2 — schema for more entities + first real event decoded):
  Two parallel paths (next ticks can pick either or both):

  PATH A — write a MockFactory contract + verify end-to-end log decode:
    1. Write contracts/MockFactory.sol (in worktree, ~30 lines):
       - Single function emitTrustCreated(creator, trustId, trustAddress)
       - Emits Factory_TRUSTCreatedEvent with same signature as real Factory
    2. Compile via forge (no node_modules needed for a self-contained contract)
    3. Deploy to Anvil via forge create
    4. Set AEQI_INDEXER_FACTORY=<address> + restart indexer
    5. cast send to call emitTrustCreated() — observe indexer log decode + insert
    6. GraphQL query: trust(address: "0x...") returns the row

  PATH B — Phase 2 schema expansion (more entities):
    1. Add migrations: 006_modules, 007_role_assignments, 008_proposals, 009_proposal_votes, 010_token_balances, 011_vesting_positions, 012_funding_states
    2. Add corresponding Rust structs in store.rs
    3. Add GraphQL types + queries
    4. Generate sol! types for TRUST + Role.module + Governance.module + Token.module + Vesting.module + Budget.module
    5. Add handler functions per (module × event)

  PATH C — bridge integration to apps/ui:
    1. Read aeqi/apps/ui Treasury / Ownership tabs to see what queries they need
    2. Add corresponding GraphQL resolvers
    3. Wire client to indexer GraphQL endpoint

  LEVERAGE PRIORITY: A first (fastest proof of full stack working), then B (broader entity coverage), then C (apps/ui glue can be done by user when awake).
BLOCKER: none
ANVIL: RUNNING, PID 1274467, log /tmp/anvil.log
WORKTREE: /home/claudedev/aeqi-indexer-build (branch indexer-build, off origin/main 7553a083)
COMMITS so far on indexer-build:
  - 76141446 indexer(phase-0): fix alloy feature flags + lock build log state
  - d9216b8f indexer: fix loop prompt paths
  - <plus an earlier scaffold commit>
DECISIONS LOCKED:
  - SQLite (rusqlite), not Postgres
  - alloy v1 features="full"
  - async-graphql v7 + async-graphql-axum
  - Crate path: crates/aeqi-indexer/
  - ABIs source: /home/claudedev/projects/aeqi-graph/abis/
  - Anvil port 8545, chain 31337, block-time 2s
ENVIRONMENT VERIFIED:
  - Foundry 1.5.1-stable
  - Anvil RUNNING
  - Rust 1.94.1, edition 2024
  - Crate compiles clean
```

## Plan

```
Hour 1: Setup (Task #15)
  ✗ Cut worktree at /home/claudedev/aeqi-indexer-build
  ✗ Verify Foundry installed (forge, cast, anvil)
  ✗ Install if missing
  ✗ Verify local Postgres reachable
  ✗ Scaffold aeqi/crates/aeqi-indexer/ Cargo crate
  ✗ Add deps: alloy + sqlx + axum + async-graphql + tokio + tracing
  ✗ Verify cargo check passes
  
Hour 2-3: Phase 0 (Task #16)
  ✗ Start Anvil locally on port 8545
  ✗ Deploy aeqi-core contracts to Anvil (use existing scripts in ~/projects/aeqi-core)
  ✗ Note deployed Factory address
  ✗ Generate alloy types from aeqi-core/abis/Factory.json
  ✗ Connect alloy provider to Anvil
  ✗ Trigger TRUST creation tx
  ✗ Decode the event
  ✗ Insert one row in Postgres `trusts` table (single migration)
  ✗ Stand up axum + async-graphql with one query: trust(id: ID!)
  ✗ Query via curl, verify

Hour 4-5: Phase 1+2 (Task #17 + #18)
  ✗ WSS log subscription (or polling fallback)
  ✗ committed_blocks table for reorg tracking
  ✗ Confirmation depth (12 blocks, configurable)
  ✗ Schema for Account, TrustContract, Module, ModuleRegistry, Beacon, Role basics
  ✗ Compound PKs not string IDs
  ✗ All migrations additive in store/migrations/

Hour 6-7: Phase 3 (Task #19)
  ✗ Static handlers: Factory.TRUST_Created, TRUST.ModuleAdded, TRUST.RoleGranted, Beacon.* basics
  ✗ End-to-end: Anvil deploy TRUST → indexer catches → row in Postgres → GraphQL query returns it
  ✗ This is THE proof point

Hour 8: Wrap-up (Task #21)
  ✗ Build log final state
  ✗ Commit everything
  ✗ Memory entries for architectural decisions
  ✗ Clean handoff doc for next session
  ✗ Per-tick log of what was attempted vs done

Stretch (if hours remain): Phase 4 partial (Task #20)
  - module_registry table
  - Dynamic dispatch on TRUST_ModuleAdded
  - Role module handler skeleton
```

## Decisions made (lock here, never re-derive)

1. **SQLite for indexer DB** (not Postgres). aeqi-platform uses rusqlite; matching engine simplifies self-host + zero infra setup. SQLite handles MVP scale (10s-100s of TRUSTs, ~100 events/min sustained max). Revisit Postgres if 10k tenants.
2. **alloy v1 with features="full"**. Single broad feature set instead of micro-managing transports-* / providers / etc. Simpler.
3. **Worktree at `/home/claudedev/aeqi-indexer-build`**, branch `indexer-build`. ALL work happens here. Ship via /ship when phase-complete.
4. **ABIs source: `/home/claudedev/projects/aeqi-graph/abis/`** — 17 JSONs. Don't move them yet; reference in place.
5. **Local Anvil for testing**, no public testnet. Default port 8545.
6. **Ship workflow**: each phase that produces meaningful working code → /ship cycle. Don't accumulate uncommitted state across many phases.
7. **PIVOT (TICK 5): Build indexer against ABIs first, defer live deploy.** The aeqi-core Foundry deploy script (`scripts/foundry/Deploy.s.sol`) is out of date — Beacon.setImplementation signature evolved to require `(source, moduleId, impl)` (3 args), script still passes `(moduleId, impl)` (2 args). Fixing that script properly requires understanding the new "source" semantics in Beacon — that's a real contract-design question, not a 5-min fix. So the indexer is being built against ABIs (which are accurate to current contracts) using synthetic event data. Live deploy can be solved separately by the user when awake, or by patching the script in a later session. The indexer code is independent of whether contracts are actually live.

## Blockers encountered

(empty initially — fill as I hit them)

## Per-tick log

(append every tick: tick #, what I did, what's next)

```
TICK 0 — wrote this log + planned + created tasks #15-#21
TICK 1 — cut worktree, added crate to workspace, scaffolded crates/aeqi-indexer/
         (Cargo.toml + lib.rs + main.rs + config.rs + chain.rs + decode.rs + store.rs)
         added alloy v1 + async-graphql v7 to workspace deps
         FIXED: alloy feature flags (transports-http → just "full")
         cargo check running in bg, output at /tmp/claude-1000/.../blql4a31l.output
```

## Constraints (from user)

- Use Foundry / Anvil for local testnet (no public testnet needed)
- Manage own keys in local keystore — never ask user
- Stripe TEST MODE allowed for paymaster simulation
- Account abstraction (4337) is part of the goal but won't fit in 8h
- Subagents OK: Haiku for exploration, Sonnet for implementation, Opus for hard decisions
- Commit often — preserve state for next tick
- Check this log first thing every tick

## What I will NOT do

- Pretend I shipped more than I did
- Skip commits to "save time"
- Make major architectural decisions without writing them in this log
- Break working code to chase the next phase
- Ask the user anything (they're asleep)

## Self-correction loop (every tick)

1. Read this log
2. Identify next action from "Plan" section
3. Execute it
4. Update "Current state" + append to "Per-tick log"
5. If stuck: add to "Blockers", switch to next leverage point
6. Commit code changes immediately

## Final handoff format (the user wakes up to this)

End-state of this log will tell the user:
- What's working (with evidence: commit SHAs, commands to verify)
- What's partial (next steps)
- What's blocked (with documented reasoning)
- Realistic next session estimate

No bullshit. No claiming success that didn't happen.
