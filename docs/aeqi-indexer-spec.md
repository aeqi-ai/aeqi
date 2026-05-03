# aeqi Indexer — Architecture Spec

**Status:** Decided 2026-05-03. Build target: ~8-12 weeks for parity with the existing subgraph on Sepolia.
**Companion docs:**
- `aeqi-graph-survey.md` — the prior subgraph + contract event inventory (input to this spec)
- `wallet-architecture.md` — the AEQI Entity / TRUST architecture
- `mvp-execution-plan.md` — Phase 2 places this work in the broader sequence

## Decision (the headline)

Replace the TheGraph subgraph (`~/projects/aeqi-graph`) with a **native Rust indexer** running alongside the aeqi runtime. No TheGraph, no graph-node, no IPFS. Postgres-native (same DB as `aeqi-platform`). Async-graphql API mirroring the subgraph's query surface. Self-hosters get their own indexer for free; aeqi-platform runs its own for the public Discover surface.

**Crate location:** `aeqi/crates/aeqi-indexer/` (new). Survey input `~/projects/aeqi-graph` stays as reference.

## Scope (from the survey, honest numbers)

| Surface | Count | Implication |
|---|---|---|
| Entity types (across 18 partial schemas) | **~75** | ~75 Postgres tables (or fewer after normalization) |
| Contract event signatures | **~135** | ~135 event-decode + apply functions |
| Handler functions (across 13 mapping files) | **~140** | One Rust `apply_<event>` per handler — mostly straightforward |
| AssemblyScript LOC to port | **~6.6k** | ~50% reduction expected in Rust due to type-driven brevity |
| Module families | **12** (Budget, Funding, Fund, Governance, Role, Token, Vesting, Unifutures, UniswapPM, UnifuturesPM, Foundation*, Beacon proxy) | One handler module per |
| Stats singletons | **7** (Metadata, ModuleStats, BeaconStats, FundStats, UnifuturesStats, 2 PM stats) | High-contention row updates — see strategy below |

\* Foundation is orphan in the survey — schema/contract missing despite handler+helper present. Drop or stub.

**Bulk profile:** 80% straight upsert-on-event handlers. 20% are the hard mechanics (dynamic data sources, eth_call backfills, bidirectional links, partner aggregation, stats singletons, reorg). The hard 20% is what gates the build.

## Architecture

```
aeqi/crates/aeqi-indexer/
├── src/
│   ├── lib.rs                       Public API
│   ├── config.rs                    RPC URL, contract addresses, start block, db pool
│   ├── runtime.rs                   tokio main loop: fetch → decode → apply → commit
│   ├── chain/
│   │   ├── mod.rs
│   │   ├── log_subscriber.rs        WSS subscription + polling fallback
│   │   ├── reorg.rs                 Block-hash tracking, revert-on-reorg
│   │   ├── archive.rs               Bulk historical backfill (range eth_getLogs)
│   │   └── eth_call.rs              At-block view-method reads with cache
│   ├── decode/
│   │   ├── mod.rs
│   │   └── abis.rs                  alloy-sol-macro generated types from /aeqi-core/abis
│   ├── dispatch/
│   │   ├── mod.rs
│   │   ├── module_registry.rs       Persistent map of address → module type, watched/active
│   │   └── module_ids.rs            keccak constants matching aeqi-core (single source of truth)
│   ├── schema/
│   │   ├── mod.rs
│   │   ├── account.rs               Translated from account.graphql
│   │   ├── trust.rs                 trust.graphql
│   │   ├── factory.rs
│   │   ├── beacon.rs
│   │   ├── modules/
│   │   │   ├── budget.rs
│   │   │   ├── funding.rs
│   │   │   ├── fund.rs
│   │   │   ├── governance.rs
│   │   │   ├── role.rs
│   │   │   ├── token.rs
│   │   │   ├── vesting.rs
│   │   │   └── unifutures.rs
│   │   └── stats.rs                 Singleton stats rows (Metadata, ModuleStats, etc.)
│   ├── handlers/
│   │   ├── mod.rs
│   │   ├── factory.rs
│   │   ├── beacon.rs
│   │   ├── trust.rs
│   │   ├── modules/                 (mirrors schema/modules/)
│   │   │   └── ...
│   │   └── helpers/
│   │       ├── account.rs           Cross-entity lookups + ID derivation
│   │       ├── deferred_links.rs    Bidirectional Funding↔Exit linking outbox
│   │       └── partner.rs           Cumulative metrics aggregation
│   ├── store/
│   │   ├── mod.rs                   sqlx Pool, transactional apply
│   │   ├── migrations/              One additive .sql per entity
│   │   └── queries.rs               Common upsert + counter operations
│   └── api/
│       ├── mod.rs
│       ├── graphql/
│       │   ├── schema.rs            async-graphql definitions
│       │   ├── resolvers/           Per-entity resolvers + Event interface union
│       │   └── server.rs            axum route mounting /graphql
│       └── server.rs                Healthz, metrics, GraphQL endpoint
├── Cargo.toml                       alloy + sqlx + axum + async-graphql + tokio + tracing
└── README.md                        Self-host docs
```

**Stack:**
- `alloy` — EVM types + RPC (replaces ethers-rs and graph-node's WASM bindings)
- `sqlx` (Postgres) — typed queries, compile-time checked
- `axum` — HTTP server
- `async-graphql` — GraphQL API (mirrors subgraph DX)
- `tokio` — async runtime
- `tracing` — structured logs
- `serde` — config / event payloads

## The 7 hard things (and how we solve each)

### 1. Dynamic module dispatch (subgraph "data sources")

**Problem:** `TRUST_ModuleAdded` / `ModuleDeployedWithConfig` events spawn new contracts at runtime. The indexer must start watching those addresses dynamically — not at config time.

**Solution:** Persistent `module_registry` table keyed on address.
- Schema: `(address, module_type, trust_id, first_seen_block, watched_since_block, active)`
- On startup: load all `active=true` rows into in-memory watch set
- On `TRUST_ModuleAdded`: dispatch via `module_ids.rs` lookup (keccak256 must match contract); insert row + add to in-memory set
- On `ModuleRemoved` events: set `active=false`, keep row for historical replay
- Log subscriber filter: `address IN (watch set)` updated on every dispatch

**Why this works:** subscribe-by-address eliminates the "watch all logs and filter in code" overhead. WSS subscriptions support address filters; polling fallback uses `eth_getLogs` with the address list.

### 2. At-block contract reads (`eth_call` backfills)

**Problem:** Almost every handler calls `Contract.bind(addr).try_<view>()` to populate fields the event itself doesn't carry. The indexer needs historical RPC reads at the event's block number, with caching.

**Solution:** `chain/eth_call.rs` wraps RPC client with:
- Block-number-bound calls (RPC must support `eth_call` at historical block — Alchemy and QuickNode do; Infura archive does)
- LRU cache keyed on `(contract_address, function_selector, args, block_number)` — same struct often re-read across many events at the same block
- Batch-aware: collect calls for the same block, fire as `eth_call` batch
- Fail-soft: if a `try_*` call fails, fall back to event-only data + log warning

**Capacity planning:** ~135 events × (1-3 backfill calls each) = 200-400 RPC calls per block in burst. Cache hit rate should be high (>70%) in steady state. Use Alchemy/QuickNode growth tier; track call rate via metrics.

### 3. Bidirectional links with order-dependence

**Problem:** Funding ↔ Exit / CommitmentSale / BondingCurve linkage requires both directions populated regardless of event arrival order.

**Solution:** `handlers/helpers/deferred_links.rs` outbox:
- Schema: `pending_links(source_id, target_id, source_field, target_field, expected_kind, created_at)`
- On forward write: if target row doesn't exist yet, insert pending link row
- On any insert of a row whose ID matches a pending link: resolve + delete pending link
- Periodic sweeper (every 60s): warn on stale pending links >1h old (likely indicates contract bug)

**Alternative considered:** allow NULL on one side, fix on second-event arrival. Cleaner for query consumers (no NULL handling) is the outbox pattern; we adopt it.

### 4. Partner / Stats aggregation (cumulative metrics)

**Problem:** `Partner.experience`, `directTradingProfit`, `exitSuccessRate`, `TRUSTContract.totalValueLocked` are pure functions of historical events but updated incrementally on every relevant event.

**Solution:** Two-tier strategy:
- **Hot stats** (Metadata global counter, per-trust TVL): update inline in same Postgres txn as the triggering event. Use `UPDATE ... SET v = v + delta WHERE id = $1`. Lock contention OK at expected event volume (single tenant: <100 events/min worst case).
- **Computed projections** (Partner experience tier, success rates): treat as derived. Two options:
  - **A — incremental** in handler: add to a `partner_metrics_delta` log; nightly compaction job rolls up. Realtime queries see slightly-stale stats.
  - **B — on-demand**: compute from event log at query time via `SUM(...) WHERE partner = $1`. Always accurate, slower for hot reads.
- **Lock the choice per-stat** in the spec, not at code-write time. Default to **A** for stats queried frequently (Metadata, TVL), **B** for stats queried rarely (deep partner analytics).

### 5. Composite / typed IDs (the separator mess)

**Problem:** Existing subgraph mixes `-`, `@`, `/`, prefixed, and convention varies per entity. Downstream tools (any UI consuming subgraph) depend on these strings.

**Decision: drop the strings, use typed compound primary keys in Postgres.** Reasons:
- We're rewriting the consumer (`apps/ui`) anyway via the `apps/ui` integration phase
- Postgres compound PKs are first-class (`PRIMARY KEY (trust_id, role_id)`) — cleaner than concatenated strings
- GraphQL output can re-derive composite string IDs as a virtual field for any external consumer who needs the legacy format

**Cost:** any external tool currently consuming `aeqi-graph`'s GraphQL gets a breaking change. Acceptable — there are no external consumers (the subgraph wasn't published widely). Internal apps/ui rewrite is in scope anyway.

**Migration path:** the spec ships virtual field `legacyId` on entities that had string IDs in the subgraph; it computes `format!("{addr}@{key}")` on-demand. App code can move to compound IDs at its own pace.

### 6. `Account` fan-in monster

**Problem:** Single `Account` entity has 25+ derived fields and 10+ typed `as<X>Contract` slots. Mirroring 1:1 in Postgres = an `accounts` table with N nullable FK columns — fragile and ugly.

**Solution:** Normalize.
- `accounts` table: bare minimum (`id`, `first_seen_block`, `metadata`)
- One typed table per `<X>Contract`: `trust_contracts`, `governance_contracts`, `token_contracts`, etc., each with FK to `accounts.id`
- GraphQL resolver for `Account.asTrust`, `Account.asGovernance` etc. = JOIN
- Derived fields (`roles`, `votes`, `proposed`) = derived from FK relationships, resolver-side

**Result:** schema is 6NF-ish on the address dimension, GraphQL surface preserves the subgraph DX. Best of both.

### 7. Reorg handling (graph-node gives this for free; we have to build it)

**Problem:** Chain reorgs invalidate previously-applied events. graph-node tracks block hashes and re-runs handlers; we must too.

**Solution:**
- **Track block hash + parent hash** for every committed batch: `committed_blocks(block_number, block_hash, parent_hash, committed_at)`
- **Immutable rows** (`@entity(immutable: true)` in subgraph): tag with `block_number`. On reorg, `DELETE WHERE block_number > $reorg_point`.
- **Mutable rows**: maintain `row_history(table_name, row_id, block_number, prior_state_json)`. On reorg, reverse-apply from history table down to safe point. Costs storage but unavoidable for upsert-pattern handlers.
- **Confirmation depth**: defer commits N blocks behind head (configurable; default 12 blocks for Base = ~24s lag). Most reorgs resolve within 2-3 blocks; 12 is generous.
- **Reorg detection**: every batch fetch compares parent hash of new block to last-committed hash. Mismatch = reorg → unwind + re-apply from divergence point.

This is genuine engineering, not boilerplate. Budget 1.5-2 weeks for reorg handling alone.

## Singletons strategy

Seven hot rows everyone touches: `Metadata` (global), `ModuleStats`, `BeaconStats`, `FundStats`, `UnifuturesStats`, `UniswapPositionManagerStats`, `UnifuturesPositionManagerStats`.

**Postgres advantage:** these can be `UPDATE ... SET v = v + 1 WHERE id = 'global'` in the event txn. Row-level locks serialize per-row but our event volume per row is low (<100/min worst case). No need for materialized views or async refresh patterns at MVP scale.

**At larger scale (10k tenants):** revisit with continuous aggregates (TimescaleDB extension) or materialized views refreshed every 30s.

## Schema migrations strategy

**Additive-only migrations** in `store/migrations/`:
- One `.sql` file per entity, named `NNN_<entity>.sql`
- Adding a column: new migration `NNN_<entity>_add_<column>.sql`
- Renaming or dropping: deprecate column in one migration, remove in a later migration with explicit data migration
- Migrations run on indexer startup via sqlx `MIGRATOR.run()` — no external migration tool

**No schema-from-genesis re-sync.** Unlike subgraph, our Postgres schema can evolve without re-indexing from block 0. New entities can backfill from chain history on-demand.

## API surface

`async-graphql` schema mirrors the subgraph's query surface 1:1 for porting ease:

```graphql
type Query {
  trust(id: ID!): TrustContract
  trusts(first: Int, skip: Int, where: TrustFilter): [TrustContract!]!
  account(id: ID!): Account
  proposal(id: ID!): Proposal
  # ... mirrored from existing subgraph schema
}
```

**Subscriptions:** add later. Subgraph doesn't have them; not blocker for parity.

**Endpoint:** `/graphql` mounted on the same axum server as `aeqi-platform` (or a dedicated port if isolation needed). For self-hosters: localhost:8500 by default.

**Auth:** open-read by default (subgraph behavior). Tenant-scoped reads gated via aeqi-platform's session middleware when consumed from apps/ui.

## Build phases

| Phase | Deliverable | Effort |
|---|---|---|
| **0 — Spec lock + scaffold** | This doc reviewed. Cargo crate scaffolded. alloy + sqlx + axum + async-graphql wired. Hello-world: connect to Base Sepolia, fetch latest block, log it. ABI loading working from `~/projects/aeqi-core/abis/`. | 3-4 days |
| **1 — Block fetcher + reorg** | Subscribe to logs (WSS or polling). Track block hashes. Reorg unwind tested against a forced reorg on Sepolia. Confirmation depth configurable. | 1.5-2 weeks |
| **2 — Schema layer (75 entities)** | Translate every subgraph entity to Postgres DDL + Rust struct + sqlx queries. All migrations additive. Compound IDs replace string concatenation. | 1.5-2 weeks |
| **3 — Static handlers (Factory, Beacon, TRUST)** | Wire ~30 events from the always-on contracts. End-to-end: deploy a TRUST on Sepolia → indexer creates `trusts` row + `accounts` row + emits via GraphQL query. | 1-1.5 weeks |
| **4 — Dynamic module dispatch** | Module registry table. WSS filter rebuilding on `TRUST_ModuleAdded`. Test: deploy TRUST, add Role module, verify Role events index. | 1 week |
| **5 — Module handlers (8 modules × ~10-15 events each)** | Port Role, Governance, Token, Vesting, Budget, Funding, Fund, Unifutures handlers. Code-generate skeletons from ABI; hand-write apply_* logic. Bidirectional link outbox for Funding↔Exit. | 2-3 weeks |
| **6 — eth_call backfill layer** | At-block view reads with LRU cache. Test against handlers that need `getFunding(id)` / `getCommitmentSale(id)` / etc. | 4-5 days |
| **7 — Stats singletons + cumulative aggregates** | Metadata, 6 module stats, partner aggregation. Lock contention tested at synthetic event volume. | 4-5 days |
| **8 — async-graphql API** | Mirror subgraph schema. Per-entity resolvers. Event interface as discriminated union. JOIN-based `Account.asXxx` resolvers. | 1 week |
| **9 — apps/ui consumption** | Treasury / Ownership / Governance tabs in apps/ui query the indexer. Replace any subgraph queries (likely none in apps/ui yet — clean slate). | 3-5 days |
| **10 — Self-host packaging** | systemd unit for `aeqi-indexer.service`. Config via env. README for self-hosters. | 2-3 days |

**Total: ~10-12 weeks for parity** with the existing subgraph + apps/ui consumption layer wired. Plus Phase 1 (modernize TRUST contracts for AA) running in parallel, which feeds new events into the indexer (passkey signer registration, session-key issuance, recovery proposals — these get added in a phase 11 once contracts ship).

This is bigger than my initial 5-6 week estimate. The survey revealed the surface area (75 entities, 140 handlers, dynamic dispatch, eth_call backfill, reorg) is materially more than I assumed.

## Per-runtime topology

```
LOCAL DEPLOY (self-host):
  postgres                      (one DB)
  aeqi-platform.service         (auth, billing, runtime orchestration)
  aeqi-host-<entity>.service    (per-tenant runtime, agents)
  aeqi-indexer.service          (NEW — indexes the user's own TRUSTs)
  
  config:
    INDEXER_RPC_URL=https://...   (user's RPC, default Alchemy free tier)
    INDEXER_DB_URL=postgres://...
    INDEXER_TRUST_FACTORY=0x...   (deployed factory address on chosen chain)
    INDEXER_START_BLOCK=...
    INDEXER_CHAIN_ID=8453         (Base mainnet) or 84532 (Base Sepolia)

PLATFORM DEPLOY (aeqi.ai hosted SaaS):
  Same services + a separate indexer instance configured to watch ALL public
  TRUSTs network-wide for the Discover surface. Same code, different config.
```

## What's deferred from MVP

- **Foundation module** — orphan in current code (handler+helper without schema or contract). Drop or stub for V2.
- **`*_Reset` events** — dev-only state-wipe events. Index as audit log only if useful, otherwise drop.
- **Multi-chain support** — Base only at MVP. Indexer is chain-aware (single instance per chain) — running multiple chains = multiple indexer processes pointing at same DB with namespaced tables. Defer to v2.
- **Subscriptions / live queries** — async-graphql supports them; subgraph didn't have them; defer.
- **Public GraphQL endpoint with rate limiting** — internal-only at MVP. External public API is v2.
- **Indexer dashboards / observability UI** — log + Prometheus metrics at MVP. Pretty UI later.

## What's NOT yet covered (depends on contract modernization)

These events don't exist in current TRUST and need contract work first (Phase 1 of wallet-architecture build plan):

- Passkey signer registration (`SignerAdded` / `SignerRemoved` with passkey type)
- Session-key delegation (`SessionKeyIssued` / `SessionKeyRevoked` / `SessionKeyUsed`)
- Recovery facilitator proposals (`RecoveryProposed` / `RecoveryActivated` / `RecoveryCancelled`)
- 4337-related events (UserOp execution traces, paymaster sponsorship)

Once contracts emit these events, add handlers in a phase 11. Schema additions are additive.

## Open decisions (decide before code, or default at start)

1. **Confirmation depth** — recommend **12 blocks for Base** (~24s lag). Trade off latency vs reorg-safety. Open.
2. **`eth_call` cache size** — recommend LRU with 10k entries (~1MB). Tune with metrics.
3. **Reorg history retention** — recommend 1000 blocks of `row_history` (~33min on Base). Beyond that, drop history (reorgs deeper than 1000 blocks are catastrophic — manual intervention).
4. **Partner/Stats aggregation strategy per-stat** — table in this doc lists candidates; decide before phase 7.
5. **Foundation orphan** — drop or stub? Recommend drop. Open.
6. **Indexer DB schema namespace** — `idx_*` table prefix, OR Postgres schema `idx`, OR shared with platform tables. Recommend `idx` Postgres schema for clean separation while sharing connection pool. Open.

## What I'd build first (Phase 0 → 1)

Day-1 to day-3:
1. Scaffold `aeqi/crates/aeqi-indexer/` with Cargo.toml + minimal main.rs
2. Wire alloy RPC client to Base Sepolia
3. Load Factory.sol ABI from `~/projects/aeqi-core/abis/`
4. Decode one Factory event from a known TRUST creation tx — print to stdout
5. Wire sqlx connection to local Postgres
6. Insert one row in a `trusts` table (manually defined)

That's the smallest end-to-end loop. From there, expand outward: more events → reorg handling → dynamic dispatch → modules.

## Memory entries to add when this lands

1. `architecture_indexer_rust_native.md` — locks the no-TheGraph + no-IPFS + Rust-native indexer pattern
2. `architecture_indexer_data_model.md` — locks the typed compound PK + normalized Account approach (vs subgraph's string IDs + fan-in Account)
3. `project_indexer_build_phases.md` — pointer to this doc with phase summaries

## TL;DR

**Build a Rust-native indexer at `aeqi/crates/aeqi-indexer/`.** Replaces TheGraph subgraph. Postgres-native (same DB as platform). Async-graphql API mirroring subgraph DX. Self-hosters get their own indexer for free.

**Surface area is real:** 75 entities, ~135 contract events, ~140 handlers, plus dynamic module dispatch, eth_call backfills, reorg handling, bidirectional links, stats singletons. **~10-12 weeks for parity.**

**The hard 20% is gateable:** dynamic dispatch, reorg handling, eth_call backfills, bidirectional links, stats. Each has a clear strategy in this doc.

**The straightforward 80% is code-generatable:** event ABIs → handler skeletons → hand-written apply_* logic.

**No Foundation, no IPFS, no graph-node, no AssemblyScript runtime.** Direct stack: alloy + sqlx + axum + async-graphql + tokio.

**First action:** scaffold the crate + connect to Sepolia + decode one Factory event. ~3-4 days. Output is a working hello-world indexer.

Survey input: `aeqi-graph-survey.md`. Build against this spec.
