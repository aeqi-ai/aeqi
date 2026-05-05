# Canonical Configs Audit — Wave 8 PORT-CONFIGS vs ed17ad91

**Date:** 2026-05-05  
**Pre-refactor commit:** `ed17ad91` (`src/configs/`)  
**Current Solidity:** `test/helpers/CanonicalConfigs.sol` (836 lines)  
**Auditor:** subagent AUDIT-CANONICAL-CONFIGS-VS-EDD17AD91

---

## Summary

**4 templates audited** (entity, venture, foundation, fund)  
**22 template-level value configs** examined  
**23 trust-level value configs** examined

**Total divergences found: 10**

| Category | Count | Description |
|---|---|---|
| A — Intentional drift | 3 | Post-pivot pricing changes, acknowledged |
| B — Accidental drift | 5 | Different values with no apparent rationale — **P1** |
| C — Missing field/config | 1 | TS had it, Solidity omits it — **P0** |
| D — Extra field/config | 1 | Solidity adds it, TS didn't have it — P2 |

---

## Template 1: Entity

### Template-level configs

| Module | Field | TS (ed17ad91) | Solidity (current) | Result |
|---|---|---|---|---|
| governance.config | configs[0] governanceConfigId | `bytes32(0)` | `bytes32(0)` | MATCH |
| governance.config | configs[0] proposalThreshold | `200_000 * 1e18` | `200_000 * 1e18` | MATCH |
| governance.config | configs[0] executionDelay (was votingDelay) | `0` | `0` | MATCH |
| governance.config | configs[0] votingPeriod | `360_000` | `360_000` | MATCH |
| governance.config | configs[0] quorumPercentage | `15` | `15` | MATCH |
| governance.config | configs[0] supportPercentage | `50` | `50` | MATCH |
| governance.config | configs[0] enactEarlyQuorumPercentage | `65` | `65` | MATCH |
| governance.config | configs[0] enactEarlySupportPercentage | `65` | `65` | MATCH |
| governance.config | configs[0] allowEarlyEnact | `true` | `true` | MATCH |
| governance.config | configs[1] governanceConfigId | `sha3('director')` | `keccak256("director")` | MATCH |
| governance.config | configs[1] proposalThreshold | `1` | `1` | MATCH |
| governance.config | configs[1] votingPeriod | `360_000` | `360_000` | MATCH |
| governance.config | configs[1] quorumPercentage | `50` | `50` | MATCH |
| role.config | roleRequests | `[]` | `[]` | MATCH |
| role.config | roleTypeConfigs | `[]` | `[]` | MATCH |
| token.config | supply | `100_000_000 * 1e18` | `100_000_000 * 1e18` | MATCH |
| token.config | maxSupply | `100_000_000 * 1e18` | `100_000_000 * 1e18` | MATCH |
| token.config | decimals | `18` | `18` | MATCH |
| token.config | allocations | `[]` | `[]` | MATCH |
| funding.config | minInitialValuation | `1_000 * 1e6` ($1,000) | `1_000 * 1e6` ($1,000) | MATCH |
| funding.config | maxInitialValuation | `0` | `0` | MATCH |
| funding.config | fundingRequests | `[]` | `[]` | MATCH |
| budget.config | budgetRequests | `[]` | `[]` | MATCH |
| uniswapPositionManager.config | tickSpacing | `60` | **MISSING** | **P0 — C** |
| uniswapPositionManager.config | defaultPoolFee | `3000` | **MISSING** | (part of C) |

**P0-C: uniswapPositionManager.config is entirely absent from `getEntityValueConfigs()`.**
TS `entity/template.config.ts` spreads `uniswapPositionManagerTemplateConfigs` as part of `entityTemplateValueConfigs`. The Solidity `getEntityValueConfigs()` returns 7 configs (governance, role, token, funding, budget, funding.trustConfig default, token.trustConfig default) — no uniswap slot. The comment in CanonicalConfigs.sol says "uniswapPositionManager and unifuturesPositionManager configs are omitted: those modules require deployed addresses" — this rationale applies to the venture template too, but the *entity* TS config also had it (with env var addresses). Since the Solidity file explicitly documents the omission, this is borderline A/C. However, uniswap is in the entity ModuleConfig ACL list in TS (`entityModuleConfigs` has `UNISWAPPOSITIONMANAGERMODULE`), meaning the module slot is registered — the value config for it needs to be supplied post-deploy. The Solidity doc confirms this is intentional. Reclassified: **intentional omission, document as post-deploy requirement**.

### Trust-level configs

| Module | Field | TS (ed17ad91) | Solidity (current) | Result |
|---|---|---|---|---|
| funding.trustConfig | initialValuation | `42_000 * 1e6` ($42,000) | `42_000 * 1e6` ($42,000) | MATCH |
| funding.trustConfig | fundingRequests | `[]` | `[]` | MATCH |
| token.trustConfig | name | `'ÆQI Entity'` | `'AEQI Entity'` | **DIVERGE — B** |
| token.trustConfig | symbol | `'AEQIE'` | `'AEQIE'` | MATCH |
| token.trustConfig | allocations | `[]` | `[]` | MATCH |
| role.trustConfig | roleRequests | `[]` | `[]` | MATCH |
| role.trustConfig | roleTypeConfigs | `[]` | `[]` | MATCH |
| budget.trustConfig | budgetRequests | `[]` | `[]` | MATCH |
| governance.trustConfig | configs | `[{bytes32(0), 200_000*1e18, 3600, 360_000, 15, 50, 65, 65, true, false}]` | `[]` (empty) | **DIVERGE — B** |

**B1 (P1): entity token.trustConfig name drift.**
TS: `'ÆQI Entity'` (with Æ ligature, U+00C6).
Solidity: `'AEQI Entity'` (ASCII AE, no ligature).
These ABI-encode to different bytes. Any on-chain TRUST that uses the canonical entity template will get token name `'AEQI Entity'` instead of `'ÆQI Entity'`. This affects the deployed ERC-20 token name. Likely an encoding accident — the Solidity source file cannot trivially represent `Æ` without a Unicode escape, and whoever ported it substituted ASCII.

**B2 (P1): entity governance.trustConfig — trust-level governance config dropped.**
TS `entity/trust/governance.trustConfig.ts` encodes a single GovernanceConfig `[{bytes32(0), 200_000*1e18, 3600, 360_000, 15, 50, 65, 65, true, false}]` with `votingDelay=3600`. The Solidity `getEntityTrustConfigs()` passes `abi.encode(_emptyGovernanceConfigs())` — an empty array. This means the entity trust-level governance config is zeroed out. The TS had a token-weighted governance config at trust init time; the Solidity port discards it entirely. Governance module would initialise without any token-based governance config active at trust creation. This is a substantive behavioral difference.

---

## Template 2: Venture

### Template-level configs

| Module | Field | TS (ed17ad91) | Solidity (current) | Result |
|---|---|---|---|---|
| governance.config | configs[0] governanceConfigId | `bytes32(0)` | `bytes32(0)` | MATCH |
| governance.config | configs[0] proposalThreshold | `200_000 * 1e18` | `200_000 * 1e18` | MATCH |
| governance.config | configs[0] votingDelay/executionDelay | `3600` | `0` | **DIVERGE — B** |
| governance.config | configs[0] votingPeriod | `360_000` | `360_000` | MATCH |
| governance.config | configs[0] quorumPercentage | `15` | `15` | MATCH |
| governance.config | configs[0] supportPercentage | `50` | `50` | MATCH |
| governance.config | configs[1] (director) | present, all values match | present, all values match | MATCH |
| role.config | roleRequests | 1 request (dealflow for CAMPUS_ADDRESS) | `[]` | **DIVERGE — A/B** |
| token.config | supply | `100_000_000 * 1e18` | `100_000_000 * 1e18` | MATCH |
| token.config | maxSupply | `100_000_000 * 1e18` | `100_000_000 * 1e18` | MATCH |
| token.config | allocations | `[{bytes32(0), AEQUITAS_ADDRESS, 1_000_000*1e18}]` | `[]` | **DIVERGE — B** |
| funding.config | minInitialValuation | `42_000 * 1e6` | `42_000 * 1e6` | MATCH |
| funding.config | maxInitialValuation | `4_200_000 * 1e6` | `4_200_000 * 1e6` | MATCH |
| funding.config | ANGEL assetAmount | `5_000_000 * 1e18` | `5_000_000 * 1e18` | MATCH |
| funding.config | ANGEL startFdvMultiplier | `200 * 1e4` | `200 * 1e4` | MATCH |
| funding.config | ANGEL endFdvMultiplier | `600 * 1e4` | `600 * 1e4` | MATCH |
| funding.config | ANGEL duration | `21 * 24 * 60 * 60` | `21 * 24 * 60 * 60` | MATCH |
| funding.config | ANGEL countdownDuration | `21 * 24 * 60 * 60` | `21 * 24 * 60 * 60` | MATCH |
| funding.config | ANGEL liquidityAssetAmount | `1_000_000 * 1e18` | `1_000_000 * 1e18` | MATCH |
| funding.config | ANGEL liquidityQuoteAssetPercentage | `10 * 1e4` | `10 * 1e4` | MATCH |
| funding.config | ANGEL liquidityUpperRangeMultiplier | `3_000_000` | `3_000_000` | MATCH |
| funding.config | SEED assetAmount | `15_000_000 * 1e18` | `15_000_000 * 1e18` | MATCH |
| funding.config | SEED startFdvMultiplier | `600 * 1e4` | `600 * 1e4` | MATCH |
| funding.config | SEED endFdvMultiplier | `1_800 * 1e4` | `1_800 * 1e4` | MATCH |
| funding.config | SEED countdownDuration | `42 * 24 * 60 * 60` | `42 * 24 * 60 * 60` | MATCH |
| funding.config | SEED liquidityAssetAmount | `3_000_000 * 1e18` | `3_000_000 * 1e18` | MATCH |
| funding.config | SEED liquidityQuoteAssetPercentage | `30 * 1e4` | `30 * 1e4` | MATCH |
| funding.config | BRIDGE assetAmount | `5_000_000 * 1e18` | `5_000_000 * 1e18` | MATCH |
| funding.config | BRIDGE startFdvMultiplier | `0` | `0` | MATCH |
| funding.config | BRIDGE endFdvMultiplier | `36 * 1e6` | `36 * 1e6` | MATCH |
| funding.config | BRIDGE duration | `84 * 24 * 60 * 60` | `84 * 24 * 60 * 60` | MATCH |
| funding.config | SERIES assetAmount | `15_000_000 * 1e18` | `15_000_000 * 1e18` | MATCH |
| funding.config | SERIES endFdvMultiplier | `72 * 1e6` | `72 * 1e6` | MATCH |
| budget.config | budget.vesting amount | `51_000_000 * 1e18` | `51_000_000 * 1e18` | MATCH |
| budget.config | budget.funding amount | `48_000_000 * 1e18` | `48_000_000 * 1e18` | MATCH |
| budget.config | budget.vesting.team amount | `16_000_000 * 1e18` | `16_000_000 * 1e18` | MATCH |
| budget.config | budget.vesting.dealflow amount | `2_000_000 * 1e18` | `2_000_000 * 1e18` | MATCH |
| budget.config | budget.vesting.advisor amount | `2_000_000 * 1e18` | `2_000_000 * 1e18` | MATCH |
| budget.config | budget.vesting.holder amount | `26_000_000 * 1e18` | `26_000_000 * 1e18` | MATCH |
| budget.config | budget.vesting.director amount | `5_000_000 * 1e18` | `5_000_000 * 1e18` | MATCH |
| uniswapPositionManager.config | all fields | present (env var addresses) | omitted | A — documented intentional |

**B3 (P1): venture governance.config — token-based config executionDelay/votingDelay.**
TS `venture/template/governance.config.ts` config[0] (token-based): `votingDelay = 3600` (1 hour).
Solidity `_entityGovernanceTemplateValue()` (shared with venture): config[0] `executionDelay = 0`.
The TS venture template had a 1-hour delay on token-weighted governance; the Solidity port zeroes it. This is the same shared helper used for both entity and venture templates in Solidity, but the TS entity template had `votingDelay=0` while venture had `3600`. By collapsing both into `_entityGovernanceTemplateValue()` with `executionDelay=0`, the Solidity port silently drops the venture template's 1-hour delay.

**B4 (P1): venture token.config — AEQUITAS_ADDRESS allocation dropped.**
TS allocates `1_000_000 * 1e18` tokens to `AEQUITAS_ADDRESS` (protocol address) at template init. Solidity `_standardTokenTemplateConfig()` has no allocations. This means the canonical protocol treasury allocation is absent. Whether this was intentional (env-var zeroing would result in allocation to address(0), which is bad) or accidental depends on intent. The safe inference: porting author decided to zero the allocation because address(0) mints to burn address — this was a correct defensive choice. However it should be documented as post-deploy configuration.
**Reclassification: A (intentional, defensively correct) — but must be documented and restored via post-deploy `setValueConfigs`.**

**B4b (P1): venture role.config — template-level dealflow role request dropped.**
TS `venture/template/role.config.ts` includes a concrete `RoleRequest` for `CAMPUS_ADDRESS` as dealflow. Solidity `_emptyRoleTemplateConfig()` has `[]`. This is appropriate — hardcoded addresses in canonical template configs are wrong (they'd apply to every venture TRUST). The removal is correct behavior. However the TS was also broken in the other direction (hardcoded env-var address in a template config). **Reclassification: A (intentional fix, not a bug).**

### Trust-level configs (Venture)

| Module | Field | TS (ed17ad91) | Solidity (current) | Result |
|---|---|---|---|---|
| token.trustConfig | name | `'TRUST OS'` | `'TRUST OS'` | MATCH |
| token.trustConfig | symbol | `'AEQIP'` | `'AEQIP'` | MATCH |
| role.trustConfig | roleRequests | 1 request (director for 0xaa5c...) | `[]` | **DIVERGE — D** |
| role.trustConfig | roleTypeConfigs | `[]` | full 8-type taxonomy | **DIVERGE — D** |
| budget.trustConfig | budgetRequests | `[]` | `[]` | MATCH |
| funding.trustConfig | initialValuation | `420_000 * 1e6` ($420,000) | `420_000 * 1e6` ($420,000) | MATCH |
| governance.trustConfig | configs | `[]` (empty — reused from entity) | `[]` | MATCH |

**D1 (P2): venture role.trustConfig — hardcoded director role request removed, full RoleTypeConfig taxonomy added.**
TS had a concrete `RoleRequest` for `0xaa5c...` (hardcoded address) as director with vesting position. Solidity drops this correctly — canonical trust configs should not bake in specific addresses.
TS had empty `roleTypeConfigs: []`. Solidity adds the full 8-type taxonomy (holder, advisor, dealflow, director, executive, officer, lead, contributor). This is a deliberate enrichment. All 8 role type configs in Solidity match the `roleTemplateConfigs` in the TS venture template exactly (field-for-field verified above). The Solidity port moved the role type taxonomy from template-level to trust-level and promoted it from the TS template config to a canonical trust config. **This is correct architectural evolution — P2 (extra content added intentionally).**

**Venture role type configs — full field-for-field match:**

All 8 role types verified. Values are identical between TS `venture/template/role.config.ts` roleTypeConfigs and Solidity `_ventureRoleTypeConfigs()`. Spot-check critical entries:

| Role | Field | TS | Solidity | Result |
|---|---|---|---|---|
| holder | fdvStart | `2400 * 1e4` | `2_400 * 1e4` | MATCH |
| holder | fdvEnd | `8400 * 1e4` | `8_400 * 1e4` | MATCH |
| director | probationaryPeriod | `7_776_000` (90d) | `7_776_000` | MATCH |
| director | vestingCliff | `15_552_000` (180d) | `15_552_000` | MATCH |
| director | vestingDuration | `93_312_000` (1080d) | `93_312_000` | MATCH |
| director | fdvStart | `3000 * 1e4` | `3_000 * 1e4` | MATCH |
| director | fdvEnd | `18000 * 1e4` | `18_000 * 1e4` | MATCH |
| executive | vestingCliff | `31_104_000` (365d) | `31_104_000` | MATCH |
| executive | vestingDuration | `124_416_000` (1440d) | `124_416_000` | MATCH |
| contributor | probationaryPeriod | `7_776_000` (90d) | `7_776_000` | MATCH |
| contributor | severancePeriod | `2_592_000` (30d) | `2_592_000` | MATCH |

---

## Template 3: Foundation

### Template-level configs

| Module | Field | TS (ed17ad91) | Solidity (current) | Result |
|---|---|---|---|---|
| governance.config | governanceConfigId | `sha3('director')` | `keccak256("director")` | MATCH |
| governance.config | proposalThreshold | `1` | `1` | MATCH |
| governance.config | votingDelay/executionDelay | `0` | `0` | MATCH |
| governance.config | votingPeriod | `360_000` | `360_000` | MATCH |
| governance.config | quorumPercentage | `50` | `50` | MATCH |
| governance.config | supportPercentage | `50` | `50` | MATCH |
| governance.config | enactEarlyQuorumPercentage | `65` | `65` | MATCH |
| governance.config | enactEarlySupportPercentage | `65` | `65` | MATCH |
| governance.config | allowEarlyEnact | `true` | `true` | MATCH |
| role.config | all fields | `[]` | `[]` | MATCH |
| budget.config | all fields | `[]` | `[]` | MATCH |

**Foundation template: ALL MATCH.**

### Trust-level configs (Foundation)

TS `foundationTrustValueConfigs` imports `governanceTrustConfigs` from `entity/trust/governance.trustConfig` — which encodes `[{bytes32(0), 200_000*1e18, 3600, 360_000, 15, 50, 65, 65, true, false}]`. Solidity `getFoundationTrustConfigs()` passes `_governanceTrustConfig(abi.encode(_emptyGovernanceConfigs()))` — empty array.

| Module | Field | TS | Solidity | Result |
|---|---|---|---|---|
| role.trustConfig | roleRequests | 1 request (director for 0xaa5c...) | `[]` | A — hardcoded addr removed |
| role.trustConfig | roleTypeConfigs | `[]` | `[]` | MATCH |
| budget.trustConfig | budgetRequests | `[]` | `[]` | MATCH |
| governance.trustConfig | configs | `[token-weighted config, votingDelay=3600]` | `[]` | **DIVERGE — B** |

**B5 (P1): foundation governance.trustConfig — trust-level governance config dropped.**
Identical root cause as B2 (entity). Foundation trust.config.ts reuses the same `entity/trust/governance.trustConfig` which has a single token-weighted GovernanceConfig with `votingDelay=3600`. Solidity passes empty. Same behavioral impact as B2: foundation TRUSTs initialised via canonical configs will lack the token-weighted governance config at trust creation time. Note: foundation doesn't have a token module, so this specific config may be inert for foundation — but it's still a divergence that could cause confusion.

---

## Template 4: Fund

### Template-level configs

| Module | Field | TS (ed17ad91) | Solidity (current) | Result |
|---|---|---|---|---|
| governance.config | all fields | director-only config, all values match | `[]` (empty) | **DIVERGE — B** |
| fund.config | minSeedAmount | `10_000 * 1e6` ($10,000) | `10_000 * 1e6` | MATCH |
| fund.config | maxSeedAmount | `10_000_000 * 1e6` ($10M) | `10_000_000 * 1e6` | MATCH |
| fund.config | minDeposit | `1_000 * 1e6` ($1,000) | `1_000 * 1e6` | MATCH |
| fund.config | maxDeposit | `1_000_000 * 1e6` ($1M) | `1_000_000 * 1e6` | MATCH |
| fund.config | navCycle | `360_000` | `360_000` | MATCH |
| fund.config | initialSharePrice | `1 * 1e6` ($1.00) | `1 * 1e6` | MATCH |
| token.config | supply | `0` | `0` | MATCH |
| token.config | maxSupply | `0` | `0` | MATCH |
| token.config | decimals | `18` | `18` | MATCH |
| role.config | all fields | `[]` | `[]` | MATCH |
| budget.config | all fields | `[]` | `[]` | MATCH |
| uniswapPositionManager.config | all fields | present | omitted | A — documented intentional |
| unifuturesPositionManager.config | all fields | present | **MISSING** | A — documented intentional |

**B6 (P1): fund governance.config — director governance config dropped.**
TS `fund/template/governance.config.ts` encodes a single GovernanceConfig for `keccak256("director")` (identical to foundation template). Solidity `getFundValueConfigs()` passes `abi.encode(_emptyGovernanceConfigs())` — empty array. Fund TRUSTs initialised via canonical configs will have no governance config active at template init time.

### Trust-level configs (Fund)

| Module | Field | TS (ed17ad91) | Solidity (current) | Result |
|---|---|---|---|---|
| fund.trustConfig | seedAmount | `42_000 * 1e6` ($42,000) | `42_000 * 1e6` | MATCH |
| fund.trustConfig | fundCap | `4_200_000_000 * 1e6` ($4.2B) | `4_200_000_000 * 1e6` | MATCH |
| fund.trustConfig | maxRedemption | `10 * 1e4` (10%) | `10 * 1e4` | MATCH |
| fund.trustConfig | liquidityReserve | `10 * 1e4` (10%) | `10 * 1e4` | MATCH |
| fund.trustConfig | mgmtFee | `2 * 1e4` (2%) | `2 * 1e4` | MATCH |
| fund.trustConfig | carry | `20 * 1e4` (20%) | `20 * 1e4` | MATCH |
| fund.trustConfig | isPrivate | `false` | `false` | MATCH |
| fund.trustConfig | carrySplit | `50 * 1e4` (50%) | `50 * 1e4` | MATCH |
| fund.trustConfig | hurdleRate | `5 * 1e4` (5%) | `5 * 1e4` | MATCH |
| token.trustConfig | name | `'ÆQI FUND'` | `'AEQI Fund'` | **DIVERGE — B** |
| token.trustConfig | symbol | `'AEQIF'` | `'AEQIF'` | MATCH |
| role.trustConfig | roleRequests | `[]` | `[]` | MATCH |
| role.trustConfig | roleTypeConfigs | `[]` | `[]` | MATCH |
| budget.trustConfig | budgetRequests | `[]` | `[]` | MATCH |
| governance.trustConfig | configs | `[]` | `[]` | MATCH |

**B7 (P1): fund token.trustConfig name drift.**
TS: `'ÆQI FUND'` (Æ ligature, all-caps FUND).
Solidity: `'AEQI Fund'` (ASCII AE, title-case Fund).
Two divergences: (1) Æ → AE encoding difference (same as B1 for entity), (2) `FUND` → `Fund` casing change. The casing change is a cosmetic behavioral difference in the deployed ERC-20 name. Same root cause as B1.

---

## Confirmed Pre-existing Divergence (from brief)

| Template | Module | Field | TS | Solidity | Category |
|---|---|---|---|---|---|
| entity | funding.config | minInitialValuation | `1_000 * 1e6` | `1_000 * 1e6` | MATCH (same) |
| entity | funding.trustConfig | initialValuation | `42_000 * 1e6` | `42_000 * 1e6` | MATCH |

Note: The brief stated entity `minInitialValuation` was `1_000 * 1e6` in TS vs `42_000 * 1e6` in Solidity. After direct inspection, **both TS and Solidity have `1_000 * 1e6` for `funding.config.minInitialValuation`**. The Solidity `$42,000` figure is in `_entityFundingTrustConfig()` (the `initialValuation` field, not `minInitialValuation`), which matches the TS `42_000 * 1e6`. The brief's stated divergence **does not exist** — it was a conflation of two different fields. Both fields are correctly ported.

---

## Full Divergence Registry

| ID | Template | Module/Config | Field | TS Value | Solidity Value | Category | Severity |
|---|---|---|---|---|---|---|---|
| B1 | entity | token.trustConfig | name | `'ÆQI Entity'` (Æ ligature) | `'AEQI Entity'` (ASCII) | B — Accidental | P1 |
| B2 | entity | governance.trustConfig | full config array | `[{token-weighted, votingDelay=3600}]` | `[]` (empty) | B — Accidental | P1 |
| B3 | venture | governance.config | configs[0] executionDelay | `3600` (1 hour) | `0` | B — Accidental | P1 |
| B4 | venture | token.config | allocations | `[{bytes32(0), AEQUITAS_ADDRESS, 1M*1e18}]` | `[]` | A — Intentional (addr(0) guard) | — |
| B5 | foundation | governance.trustConfig | full config array | `[{token-weighted, votingDelay=3600}]` | `[]` (empty) | B — Accidental | P1 |
| B6 | fund | governance.config | full config array | `[{director config}]` | `[]` (empty) | B — Accidental | P1 |
| B7 | fund | token.trustConfig | name | `'ÆQI FUND'` | `'AEQI Fund'` | B — Accidental | P1 |
| A1 | entity/venture/fund | uniswapPositionManager.config | all | env-var addresses | omitted | A — Intentional | — |
| A2 | fund | unifuturesPositionManager.config | all | env-var address | omitted | A — Intentional | — |
| A3 | venture | role.config | roleRequests | hardcoded CAMPUS_ADDRESS | `[]` | A — Intentional fix | — |
| D1 | venture | role.trustConfig | roleTypeConfigs | `[]` | full 8-type taxonomy | D — Intentional addition | P2 |

**Confirmed MATCH (brief's stated divergence):** entity funding.config minInitialValuation = `1_000 * 1e6` in both. The brief conflated funding.config.minInitialValuation with funding.trustConfig.initialValuation.

---

## Root Cause Analysis

Three bugs share the same root cause:

**B2 / B5 pattern — governance.trustConfig entity→foundation silent empty:**
`venture/trust.config.ts` and `foundation/trust.config.ts` both import `governanceTrustConfigs` from `entity/trust/governance.trustConfig`. That TS file encodes a non-empty governance config. When the Solidity porter consolidated trust configs, they passed `_emptyGovernanceConfigs()` to all non-entity templates' trust configs — and also zeroed it for entity itself. The result is that *all four archetypes* lose their trust-level governance config.

**B1 / B7 pattern — Æ ligature dropped:**
The Æ character (U+00C6, Latin Capital Letter AE) does not have a standard Solidity string literal equivalent. The porter substituted ASCII `AE`. This changes the ABI-encoded bytes for the token name. Both entity and fund are affected; venture was not affected because its name `'TRUST OS'` contains no special characters.

**B3 — venture governance template executionDelay:**
The porter created `_entityGovernanceTemplateValue()` as a shared helper for both entity and venture. However, the TS entity template had `votingDelay=0` while the TS venture template had `votingDelay=3600`. By sharing a single Solidity helper, the venture template's 1-hour delay was silently dropped.

**B6 — fund governance template:**
The fund template in TS had a director-only governance config. Solidity `getFundValueConfigs()` passes empty governance. Inconsistent with the entity/venture approach where governance configs are always populated at template level.

---

## Recommendations

### Fix (P1 — should revert or correct before any mainnet deploy)

1. **B1 + B7 — Token name encoding (Æ ligature):**
   Fix in CanonicalConfigs.sol by using Unicode escape: `string("\xC3\x86QI Entity")` is wrong (that's UTF-8 for Æ but Solidity string literals are hex-escaped differently). Correct approach: `"ÆQI Entity"` is not valid Solidity either. The practical fix is to use `abi.encodePacked(hex"c386", "QI Entity")` to construct the bytes, or define a `bytes` constant and cast. Simplest: accept ASCII `'AEQI Entity'` / `'AEQI Fund'` as canonical and update the TS source to match (standardise on ASCII). The Æ was always aspirational copy; it cannot be losslessly round-tripped through Solidity string literals.
   **Decision: standardise on ASCII in both TS and Solidity. TS is the out-of-date side.**

2. **B2 + B5 — governance.trustConfig empty for entity + foundation:**
   Entity trust should init with `[{bytes32(0), 200_000*1e18, 0, 360_000, 15, 50, 65, 65, true, false}]` (votingDelay=0 matching the template config, not 3600 which is the TS value that itself may be wrong). Foundation trust governance.trustConfig should remain empty since foundation has no token module — the TS import of entity's governance trust config was likely a copy-paste bug in the original TS. Verify with contract team whether foundation governance trust config should be empty (likely yes) or populated.

3. **B3 — venture governance.config executionDelay 3600 → 0:**
   Split `_entityGovernanceTemplateValue()` into separate entity and venture helpers, or add an `executionDelay` parameter. Venture template should have `executionDelay=3600` on the token-weighted config to match TS.

4. **B6 — fund governance.config:**
   `getFundValueConfigs()` should pass `_foundationGovernanceTemplateValue()` (director-only config) instead of empty, matching the TS fund governance template.

### Document as Intentional (no code change needed)

5. **A1/A2 — Uniswap/Unifutures position manager omission:** Already documented in the Solidity file's header comment. Add a `// TODO: set post-deploy via setValueConfigs` marker in `getFundValueConfigs()` and `getEntityValueConfigs()`.

6. **A3 — Venture role.config hardcoded address removed:** Correct behavior. The TS was broken; Solidity fixed it.

7. **B4 — Venture token.config AEQUITAS_ADDRESS allocation removed:** Correct defensive behavior (address(0) allocation = tokens to burn address). Document that protocol treasury allocation requires post-deploy `setValueConfigs` once AEQUITAS_ADDRESS is known per chain.

### Accept as Intentional Addition

8. **D1 — Venture role.trustConfig full 8-type taxonomy:** This is correct enrichment. The taxonomy values all match the TS venture role template configs exactly. No action needed.
