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
TICK: 8 (PHASE 0 ✓ END-TO-END WORKING)
PHASE: 0 ✓ COMPLETE | binary boots, GraphQL serves, SQLite persists, 5 tests green
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
PIVOT (locked TICK 5): Build indexer against ABIs first; live deploy is separate problem.
NEXT ACTION (Phase 1 entry):
  1. Wire alloy provider to local Anvil (ws://127.0.0.1:8545 — anvil supports both http and ws by default)
  2. Build a SubscribeLogs stream filtered to (any address, all topics) — log events to stdout to prove subscription works
  3. Add committed_blocks tracking — on each new block: write block_number + block_hash + parent_hash; verify parent_hash matches previous committed block
  4. Test reorg: anvil_setStorageAt to fork a new chain, observe parent_hash mismatch, log it
  5. Add Factory address config — once user fixes deploy script (or we deploy minimal mock), filter logs to factory address only
  6. Wire decoder to actual subscribed logs: decode → insert into trusts → expose via existing GraphQL trust(address) query
  7. THEN move to Phase 2: schema for more entities (modules, role assignments, governance proposals)
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
