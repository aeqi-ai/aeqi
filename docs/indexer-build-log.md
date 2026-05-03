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
TICK: 3 (npm install running for aeqi-core deps)
PHASE: 0 — environment+scaffold ✓ DONE | deploy in progress
LAST ACTION: Tried `forge script scripts/foundry/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast` from /home/claudedev/projects/aeqi-core with PRIVATE_KEY=anvil-account-0. Failed: node_modules missing (OpenZeppelin + Uniswap v4-core imports unresolved). Started `npm install --silent` in background, output at /tmp/claude-1000/.../bu4h0odi0.output.
NEXT ACTION (next tick):
  1. Check /tmp/claude-1000/.../bu4h0odi0.output for `npm install` completion (will be many minutes for ~500 OZ+Uniswap deps)
  2. If green: re-run the forge script command (same PRIVATE_KEY env, same script path)
  3. Forge will write to /home/claudedev/projects/aeqi-core/broadcast/Deploy.s.sol/31337/run-latest.json — extract Factory + TRUST + Beacon addresses from there
  4. Save those into /tmp/aeqi-anvil-addresses.json for next ticks
  5. THEN move to Phase 0 step 2 (decode TRUST_Created event in indexer)
  6. If npm install fails (e.g., dep conflict): try `npm install --legacy-peer-deps`. If still fails: pivot to Hardhat task `npx hardhat deploy --network localhost`
DEPLOYER ADDRESS: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 (Anvil account 0, derived from privkey 0xac09...)
FORGE SCRIPT PATH: scripts/foundry/Deploy.s.sol (NOT script/Deploy.s.sol — note non-standard location)
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
