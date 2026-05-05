# aeqi economy plan

**Status:** Decided 2026-05-04. Active.
**Owner:** founder / runtime team.
**Companion docs:**
- [`wallet-architecture.md`](./wallet-architecture.md) — the underlying smart-account primitive
- [`wallet-architecture-faq.md`](./wallet-architecture-faq.md) — Q&A on the wallet stack
- [`app-information-architecture.md`](./app-information-architecture.md) — URL structure and IA
- [`aeqi-inference-design.md`](./aeqi-inference-design.md) — OpenAI-compatible API endpoint (WS-5)
- [`x402-rails-design.md`](./x402-rails-design.md) — per-call payment rail for agents (WS-7)
- [`monorepo-consolidation-procedure.md`](./monorepo-consolidation-procedure.md) — aeqi-core → aeqi/contracts/ merge (WS-8)
- [`aeqi-entity-aa-design.md`](./aeqi-entity-aa-design.md) — AA stack (WS-4)

This doc consolidates the click→DAO milestone, the inference business, the payment rails (Stripe / USDC / x402), and the unit economics into one plan. It supersedes the scattered notes across `server.rs` comments and earlier session memos.

---

## Headline

We are building **four interlocking products** on **one underlying primitive**:

1. **The Company OS** — autonomous companies as software (the runtime + roles + treasury triangle).
2. **The AEQI Entity contract** — a Safe alternative + cap table + governance + session keys, all in one comprehensive smart-contract template native to Base. Personal Companies, Joint Companies, and Agents are all instances of this template.
3. **aeqi-inference** — OpenAI/OpenRouter-compatible API endpoint, billed three ways (subscription, treasury, x402). The runtime business creates the demand; the inference business funds the runtime business.
4. **Programmatic company genesis** — pay $19 in USDC via x402 to a single HTTP endpoint, get a fully-provisioned Company. The brand promise made into one API call.

The Entity contract is the substrate; the rest are surfaces on top.

---

## The economic loop (the dream)

> Agent does work → client pays USDC into Company treasury → treasury auto-debits inference as the agent runs → loop closes. Once a Company is earning, the human's $49 subscription becomes the smallest line item — basically a hosting backstop. Real economic activity happens entirely in the treasury layer above it.

This is what the architecture has to enable end-to-end. Every payment rail and every contract decision below ladders up to this loop.

---

## Architecture invariants

- **TRUST = AEQI Entity.** One smart contract template, three configurations (Personal Company, Joint Company, Agent). Same factory, same audit, same ABI. Different module configurations.
- **Pattern 3 (passkey-native ERC-4337) primary, Pattern 4 (SIWE) secondary.** Self-hosted bundler (silius) + custom paymaster contract + Rust paymaster signing service. **No third-party SaaS in the foundation** — auth, keys, wallets, identity, signing, bundling, paymasters all built in-house. Hard policy.
- **Three money flows kept distinct** (do not merge):
  - **Subscription** ($19→$49/mo per Company): paid by user's card via Stripe ($49) or by USDC pull from user's Entity ($45). Pays for runtime + included inference + everything platform.
  - **Inference top-ups**: card→credit OR USDC→treasury debit OR x402 per-call. Beyond included $25/mo allowance.
  - **Treasury operations**: the Company's own money for the Company's own purposes. We have no claim on it; we don't debit it for subscription.
- **Subscription does NOT debit treasury.** Decoupled by design. Treasury empty ≠ Company dies. Card-on-file is the survival floor.
- **Joining a Joint Company is free.** Only the creator pays. The unit isn't "user," it's "Company."

---

## The four products

### 1. Company OS — refining

**Status:** shipped, refining.

Personal Company auto-created at signup (carve-out from no-auto-create rule, decided 2026-05-03). Joint Companies via `/start/<slug>` wizard. Agents owned by parent Entity. Three rails (Personal/Company/Agent) shipped. Role primitive shipped (renamed Position→Role 2026-05-02). Session unification waves 1-3 shipped.

Refinement work (this milestone):
- `/start/<slug>` wizard with pre-creation config — name, roles, token, vesting, governance, review (WS-2).
- Co-director invite flow with seat-reserve pattern (`account = address(0)` until invitee accepts).
- Personal-OS gets a stripped wizard (no token/vesting/co-directors).

### 2. AEQI Entity contract — Safe alternative

**Status:** decided 2026-05-02 (wallet brief). Phase 1 custodial bridge in repo today. ~6-week build for Phase 2.

Already documented in [`wallet-architecture.md`](./wallet-architecture.md). Key affirmations for this plan:

- **TRUST IS the Entity IS the Safe alternative.** We considered Safe-with-modules and rejected it. Safe's primitive is co-signature; AEQI's primitive is "company with cap table + roles + governance + agent delegation." Different primitive → different contract.
- **`registerTRUST` accepts pre-populated role data atomically.** The `valueConfigs[]` slot for `role.trustConfig` carries `RoleRequest[]` (who occupies which seat) + `RoleTypeConfig[]` (what each role type means: vesting, severance, hierarchy). The current Foundry script passes empty arrays — this is the gap WS-1 closes.
- **Session-key module enables scoped agent delegation.** An on-chain policy for "Marketing-Agent role may spend up to 500 USDC/month from Treasury, signed by platform key 0xABC." User signs ONCE at company creation with their passkey to grant the scope; from then on the platform signs FOR THE AGENT (we own the agent's session key) within the bounds the user authorized. Custody never sits with us.

### 3. aeqi-inference — NEW

**Status:** new product surface. Not in repo yet.

OpenAI/OpenRouter-compatible API endpoint. **Hermes commercialized via API endpoint, not models — same play.** We never build models; we ride free model commoditization (DeepSeek, Llama, Qwen) and own the routing + billing layer.

**Three lanes:**

| Lane | Auth | Billing | Phase |
|---|---|---|---|
| Subscription | JWT (logged-in user) | Debits the Company's $25/mo allowance, then optional Stripe-credit top-up | Phase 1 |
| Treasury | API key signed by Entity | Debits inference deposit balance in Company treasury via deposit-and-meter pattern; on-chain settlement at $1 thresholds or hourly | Phase 2 (after wallet build) |
| External (x402) | HTTP 402 + EIP-3009 USDC authorization | Per-call USDC payment, settled via Coinbase facilitator (or self-hosted) | Phase 1 |

**Routing:**
- Closed models (GPT-5, Claude 4.x, Gemini 2.x) → upstream provider APIs, retail margin (cost + 10-15%).
- Open-weights (Llama 4, DeepSeek V4, Qwen) → Phase 1 routed via DeepInfra/Together; Phase 3 self-hosted GPU pool, COGS-class margin (cost + 40-60%). Phase 3 optional, do once volume justifies.

**Pricing:**

| Lane | Margin |
|---|---|
| Subscription (included $25) | -10% to break-even (loss-leader, paid by sub) |
| Subscription overage top-up | cost + 5% |
| Treasury lane | cost + 10% |
| External x402 lane | cost + 20% |

Per-token prices match OpenRouter publicly so we don't surprise anyone. **Denominated in dollars, not tokens** — tokens-as-unit is dishonest when the model is user-choice (1M Opus tokens ≠ 1M Haiku tokens by ~30×).

### 4. Programmatic company genesis — NEW

**Status:** new endpoint. Not in repo yet.

`POST /api/companies/create` returns 402 with a $19 USDC payment requirement. Caller (agent or human) provides desired blueprint slug + name + owner address + payment authorization. We settle, fire registerTRUST + provision runtime, return the Company's address + URL.

**Marketing surface:** "Pay $19 in USDC, get a company." Brand promise made into an HTTP call.

The recursive case is the wedge: an agent inside Company A earns USDC, decides to spawn Company B as a subsidiary, pays via x402, B exists. A's agent now operates B. **Agent-driven corporate genesis as a primitive.** Nobody else can offer it because nobody else has Entity-as-account + role-as-cap-table + treasury all in one contract.

---

## Workstreams

| WS | Surface | Scope | Duration | Depends on |
|---|---|---|---|---|
| **WS-1** | dao_provisioner.rs | Port `encodeRoleDaoConfig` from old aeqi-app TS to alloy `sol!` types. Update `provision_dao` to accept populated `RoleRequest[]` + `RoleTypeConfig[]`. | ~1 day | — |
| **WS-2** | apps/ui /start/<slug> | Pre-creation wizard (Identity → Roles → Token → Vesting → Governance → Review). Co-director invite seat-reserve flow. Personal-OS stripped variant. | ~3-4 days | WS-3 mock data |
| **WS-3** | aeqi-platform env + aeqi-core scripts | Anvil-fork-of-Base + Deploy.s.sol + RegisterBlueprints.s.sol + indexer pointed at it + AEQI_CHAIN_*_FACTORY + VITE_INDEXER_URL set. | ~1 day | — |
| **WS-4a** | Entity contract — stubs + tests | IAccount + P-256 passkey verifier + EOA verifier + session-key module + recovery module + paymaster contract stubs. | ~1 week | — |
| **WS-4b** | Silius bundler ops | Deploy + configure self-hosted silius instance on platform host. Integration with aeqi-platform as a tower layer. | ~1 week | — |
| **WS-4c** | Paymaster signing service | Rust microservice for ERC-4337 paymaster transaction signing. Integrates with Entity contract's paymaster module. | ~1 week | — |
| **WS-4d** | Contract → Passkey migration | Scripts to migrate existing custodial signers to passkey-based. Integration testing across contracts + bundler + paymaster. | ~1 week | WS-4a+4b+4c in progress |
| **WS-4** (parallel) | **Audit** | Wk 3 of parallel build (not Wk 4). All four arms feed into audit prep. | Wk 3 audit, Wk 4-5 review. | WS-4a+4b+4c done |
| **WS-5** | aeqi-inference | **Phase 1 Wire SHIPPED 2026-05-05** — DeepInfra provider (6 open-weight models), SSE streaming, in-memory cost accounting, subscription lane gating, `/v1/*` mounted on aeqi-platform. Integration tests (wiremock). **Phase 2** (after WS-4): treasury lane, SQLite balance debit, Anthropic+OpenAI+DeepSeek adapters. **Phase 3** (optional, +6-8 weeks): self-hosted GPU pool. | Phase 1 standalone | — for Phase 1 |
| **WS-6** | USDC subscription rail | **Phase A** (~3-5 days): SIWE users only; ERC-20 approve + monthly cron pull from external EOA. **Phase B** (after WS-4): all users via passkey-Entity; default rail for new signups. $45 USDC vs $49 card. | Phase A 3-5 days | — for Phase A |
| **WS-7** | x402 rails | `/v1/*` (inference) + `POST /api/companies/create`. x402 middleware as Tower layer. Coinbase facilitator integration (Phase 1) + self-hosted facilitator option (Phase 2). | ~1-2 weeks for the company-creation endpoint; inference x402 alongside WS-5 Phase 1 | — |
| **WS-8** | Monorepo consolidation | aeqi-core → aeqi/contracts/ via `git subtree add --squash`. ABI generation gate. Path updates in dao_provisioner + indexer. Gated on bridge verification end-to-end. | ~3-5 days execution | WS-1+WS-2+WS-3 verified |
| **WS-9** | IPFS + dao_provisioner integration | Self-hosted kubo daemon (`aeqi-ipfs.service`). Rust crate (`aeqi-ipfs`) with pin/fetch/health. Integration: `dao_provisioner` calls `IpfsClient::pin()` for operating agreements + role descriptions; CID into `TRUSTConfigRequest`. Real CIDs at company creation. | ~1 day (daemon + crate live 2026-05-04; integration in-flight) | kubo + aeqi-ipfs crate shipped |

---

## Sequencing

**Tonight (2026-05-04 20:45–23:45Z) — Wave 1-3:**
- WS-3 shipped ✓ (Anvil fork-of-Base live, deploy + register + indexer wired, bridge enabled)
- WS-1 shipped ✓ (dao_provisioner encoder port, commit 7fdeb3c, deploy in progress)
- WS-2 scaffolding shipped ✓ (wizard Identity → Roles → Token → Vesting → Governance → Review, personal-OS variant, deployed)
- WS-5 & WS-7 docs shipped ✓ (aeqi-inference-design.md, x402-rails-design.md)
- WS-9 daemon live ✓ (kubo v0.32.1 on 127.0.0.1:5001 + 127.0.0.1:8085, aeqi-ipfs Rust crate shipped 648c5d0e, integration in-flight Wave 2F)
- WS-8 procedure shipped ✓ (monorepo-consolidation-procedure.md, scheduled post-bridge-verification)
- aeqi-landing pricing.ts mirror shipped ✓ (0e5c795, FAQ updated)

**Tomorrow & next week (parallel tracks):**
- WS-2 follow-ups (wizard submission logic, role-row hover-+ for invites, Review panel calldata preview)
- WS-1 call-site wiring (already landed in 7fdeb3c; ready for production)
- WS-9 integration (Wave 2F: dao_provisioner + aeqi-ipfs + dao_provisioner call-site wiring)
- WS-4a contracts (Week 1: IAccount + verifiers + modules stubs, failing tests)
- WS-6 Phase A (SIWE users + ERC-20 approve + monthly cron pull)
- WS-7 Phase 1 lead surface (`POST /api/companies/create` x402 endpoint — fastest wedge, ships before inference)

**2-3 weeks:**
- WS-7 Phase 1 ships ("pay $19 in USDC, get a company" demo public)
- WS-5 Phase 1 ships (inference API live, subscription + x402 lanes)
- WS-6 Phase A deploys (SIWE users can subscribe in USDC)
- WS-8 executes (monorepo consolidation, gated on bridge end-to-end verification)

**3.5–6 weeks:**
- WS-4a+4b+4c run in parallel (Week 1-2 parallel build, Wk 3 audit, Wk 4-5 audit review)
- WS-4d contracts ship (passkey migration, integration testing)
- WS-5 Phase 2 unlocks (treasury inference billing via on-chain settlement)
- WS-6 Phase B unlocks (all users on USDC subscription as default; Stripe fallback)

**Defer:**
- WS-5 Phase 3 (self-hosted GPU pool) — only do once volume warrants, likely Q4.
- Subscription-from-treasury debit — Phase-3 niche for fully autonomous orgs with no human owner. Not now.
- Models. Ever. Hermes paid that tuition.

---

## Pricing (locked)

| Item | Card | USDC |
|---|---|---|
| First-month per Company | $19 | $19 |
| Steady-state per Company | $49/mo | $45/mo |
| Joining a Joint Company | $0 | $0 |
| Inference credit included | $25/mo (any model, dollar-denominated) | same |
| Inference top-up | retail (cost + 5-10%) | retail |
| External x402 inference | cost + 20% | — |

The $4 USDC discount is the Stripe fee passed through (~8%). Industry standard; drives crypto-rail adoption.

---

## Unit economics

At $49/mo steady state with the Hetzner CX32 tier (`"company"` in `vps.rs`):

| User type | Inference COGS | Other infra | Total COGS | Margin on $49 |
|---|---|---|---|---|
| Heavy (100% of $25 burned) | $22 | $11 (VPS + ops) | $33 | $16 = **33% GM** |
| Average (25% util) | $5.50 | $11 | $16.50 | $32.50 = **66% GM** |
| Idle (0% util) | $0 | $11 | $11 | $38 = **78% GM** |

Healthy at average; positive even at heavy. Idle Companies subsidize heavy ones (phone-plan actuarial pattern).

**Risk monitoring:**
- LLM cost variance — if frontier-model demand spikes COGS to $20-30 for 16M tokens, the $25 cap shifts to a different model class or price moves up. Mitigate via the dollar denomination — users see exactly what their $25 buys at each model.
- Idle VPS at scale — 100K signups × 30% idle × $8/mo = $800K/mo VPS sitting empty. **Personal Companies should default to sandbox-mode (bwrap container, near-zero marginal cost) and only auto-promote to VPS on first real usage signal.** Not the current behavior; needs WS-2 follow-up.

---

## What this enables (the strategic case)

- **Closed economic loop on autonomous Companies.** Agents earn USDC → fund their Company's treasury → pay inference from treasury → close the loop. Subscription becomes a hosting backstop, not the operating budget.
- **Inference rail for the agent economy.** Foreign agents (ElizaOS, MCP hosts, custom Python, anyone) call our `/v1/*` via x402 → pay per-call → no onboarding, no API key, no account. We become the OpenRouter-style aggregator with treasury-native billing as the unique wedge.
- **Programmatic Company genesis.** An autonomous agent decides to spawn a subsidiary → one HTTP call with $19 USDC → has a fully-provisioned multi-agent Company. Cross-chain (Solana port later) compounds this — a Solana agent maps to its Base Entity and pays in USDC on Base for Company creation on Base.
- **Two compounding moats:** the inference rail (more agents → more volume → cheaper per-token → more attractive endpoint) AND the company-creation rail (more spawned Companies → more agents on aeqi → more inference demand → loops back).

---

## What we don't build (on purpose)

- **Models.** Hermes proved monetization sits at the API endpoint, not at the model layer. Their own fine-tunes never took off commercially; their inference business did. We ride free model commoditization indefinitely.
- **Custodial wallets in v2.** Phase 1 custodial bridge is a few weeks of acceptable liability before the wallet build. After WS-4 lands, custody is gone.
- **Subscription-from-treasury debit (default).** Failure modes are bad (treasury empty → Company dies). Card-on-file is the survival floor. Defer to a Phase-3 niche feature for fully-autonomous orgs with no human owner.
- **Stripe replacement.** Card stays for normies forever. USDC is the cohabitant rail, not the replacement.
- **Privy / Magic / Dynamic / Coinbase Smart Wallet's contracts.** No third-party SaaS in the foundation.
- **Building on Safe.** Considered + rejected. Different primitive.

---

## What's in repo today vs what this plan adds

**In repo today:**
- aeqi-core: Factory + Beacon + 8 modules + Deploy.s.sol + RegisterBlueprints.s.sol (5 templates) + CreateTrust scripts. Compiles, 291/292 tests pass.
- aeqi-platform: `dao_provisioner.rs` with encoder port ✓ (WS-1, commit 7fdeb3c); chain bridge enabled on `AEQI_CHAIN_ANVIL_FACTORY` + `AEQI_CHAIN_ANVIL_RPC` + `AEQI_CHAIN_ANVIL_INDEXER_URL` (all set as of 2026-05-04 21:00Z).
- aeqi (apps/ui): `/start/<slug>` wizard scaffolding ✓ (WS-2, commit c6225eca); `lib/indexer.ts` wired to `VITE_INDEXER_URL` (live); Treasury / Ownership / Governance tabs render bridge data.
- aeqi-indexer: feature-complete, 33/33 tests pass, 10 contract types covered, service deployed at 127.0.0.1:8500/graphql.
- aeqi-ipfs crate ✓ (WS-9, commit 648c5d0e). Kubo daemon live as `aeqi-ipfs.service` on 127.0.0.1:5001 (API) + 127.0.0.1:8085 (gateway). Smoke test green.
- pricing.ts: $19 → $49 / mo with `inferenceUsd: "$25"` ✓ (commit 0e5c795, aeqi-landing mirror synced).

**This plan adds:**
- WS-1..9 as listed above (WS-1, 2, 3, 5, 7, 8, 9 docs + architecture shipped; WS-4a–d workstream specs added tonight; WS-6 Phase A queued).
- `aeqi-inference` crate Phase 1 (subscription + x402 lanes, OpenAI-compat router, Stripe top-ups).
- x402 middleware as Tower layer in aeqi-platform (`/v1/*` + `POST /api/companies/create`).
- USDC subscription module on the platform Entity contract (Phase B, after WS-4).
- Marketing surfaces: "Pay $19 in USDC, get a company"; "Inference API for the agent economy"; aeqi-landing pages for the inference + company-creation endpoints.
- WS-8 monorepo consolidation (aeqi-core → aeqi/contracts/, gated on bridge verification).

---

## Open questions deferred

- **IPFS Phase 2 replication** — self-hosted kubo is v1. Phase 2 (after bridge stabilizes) may replicate to Pinata / Filebase / w3.storage as belt-and-suspenders redundancy. Not required for v1; defer.
- **Recurring treasury auto-funding** — UX nicety where a user sets up a Stripe-recurring → USDC-into-treasury auto-top-up. Phase 2 of WS-5 alongside treasury-lane inference. Not blocking.
- **Self-hosted x402 facilitator** — start with Coinbase's `api.x402.org`; self-host if/when their policy or pricing becomes a constraint. Trivial swap (open spec). Spec lives at x402.org.
- **Solana port** — pending Colosseum hackathon date. EVM-Base remains canonical. Cross-chain agent-spawning unlocks once port lands.
- **Per-tenant inference VPS vs shared inference fleet** — Phase 1 routes through shared upstream APIs from a shared aeqi-platform instance. If Phase 3 self-hosted GPU pool lands, may want per-tenant isolation for high-compliance customers; defer.

---

## Decisions locked tonight (2026-05-04)

**IPFS foundation:**
- Keep IPFS as foundational infrastructure (reversed earlier proposal to drop it).
- Self-hosted kubo daemon (`aeqi-ipfs.service`) on platform host, no SaaS dependencies (Pinata/Web3.Storage).
- Real CIDs at company creation: operating agreements + role descriptions pinned to kubo, CID into `registerTRUST`.
- Kubo daemon live as of 21:00Z UTC 2026-05-04. aeqi-ipfs Rust crate shipped (648c5d0e). Integration in-flight (Wave 2F).

**Inference pricing:**
- $25 dollar-denominated credit per month (not token-denominated). Users see exact model + token count → exact dollars.
- Subscription included: -10% margin (loss-leader, funded by subscription revenue).
- Top-ups beyond included: cost + 5% (card) or cost + 10% (treasury).
- External x402 lane: cost + 20%.

**Subscription pricing (locked):**
- First month per Company: $19 (card) or $19 (USDC).
- Steady-state: $49/mo (card) or $45/mo (USDC).
- USDC discount is Stripe fee pass-through (~8%), drives crypto-rail adoption.
- Card on file is the survival floor; treasury debit is Phase 3 niche only.

**Entity contract stack (AA-first):**
- TRUST = AEQI Entity = Safe alternative (one smart contract, three configurations: Personal Company, Joint Company, Agent).
- Architecture: Pattern 3 (passkey-native ERC-4337) primary, Pattern 4 (SIWE) secondary. No third-party SaaS wallets.
- Passkey verifier + EOA verifier + session-key module (agent delegation) + recovery module (7-day timelock, no custody) + paymaster (self-hosted silius + ERC-4337).
- Accelerated timeline: WS-4a/4b/4c run in parallel (Weeks 1-2), audit in Week 3 (not Week 4). Contract live Wk 5-6.

**x402 programmatic company genesis:**
- `POST /api/companies/create` returns 402 for $19 USDC payment.
- Caller (agent or human) provides blueprint slug + name + owner address + EIP-3009 signature.
- Server settles via x402 facilitator (Coinbase's public API in Phase 1), fires `registerTRUST` atomically, provisions runtime.
- Returns Company address + URL. Recursive case: agent inside Company A earns, spawns Company B as subsidiary, one HTTP call.
- Branded as "pay $19 in USDC, get a company" — the wedge nobody else can offer.

**Hermes lesson internalized:**
- Never build models. Ride free model commoditization forever. Monetize the API endpoint + routing layer + billing layer.
- Inference API is the business, not fine-tuned models.

---

## Decision authority

This plan is **decided**, not proposed. Workstream owners can move within the plan without re-asking; cross-plan changes (new product surface, abandoning a workstream, repricing) re-open the doc.
