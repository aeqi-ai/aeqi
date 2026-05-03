# aeqi-graph + aeqi-core surface inventory

Source-of-truth survey for the Rust-native indexer rewrite. All entity, handler,
and event names are taken verbatim from `aeqi-graph/schemas/`,
`aeqi-graph/src/`, `aeqi-graph/subgraph.template.yaml`, and
`aeqi-core/contracts/**/interfaces/events/*.sol`.

The subgraph is a TheGraph-hosted AssemblyScript indexer with **two static
data sources** (`Factory` at a known address, `Beacon` at a known address) and
**ten dynamic templates** spawned from on-chain events: `TRUST`, `Governance`,
`Token`, `Vesting`, `Fund`, `Role`, `Budget`, `Funding`, `UnifuturesModule`,
`UniswapPositionManager`, `UnifuturesPositionManager`. The full per-contract
event-to-handler wiring lives in `subgraph.template.yaml`. The schema is
spread across `schema.graphql` (composite) plus 18 partial files under
`schemas/` that are concatenated at build time.

---

## 1. Subgraph entities

Format: **EntityName** *(immutable?)* — fields → relationships → one-line description.
Field types: `Bytes` = address/bytes, `BigInt` = uint256, `BigDecimal` = signed
decimal, `Int` = i32. `@derivedFrom` fields are reverse pointers, not stored.

### Core / cross-cutting (`schemas/account.graphql`, `metadata.graphql`)

- **Account** *(mutable)* — `id: Bytes` (address). Pure relationship hub: every
  contract address and EOA. Has 25+ derived back-pointers (delegations, votes,
  transfers, proposals, role grants, partner profile, and one
  `as<Kind>Contract: <Contract>` typed slot for every contract type the
  subgraph recognises). One row per address ever observed.
- **Metadata** *(mutable, singleton id="global")* — global counters:
  `totalTemplates`, `totalTRUSTConfigs`, `totalVentures`, `totalRoles`,
  `totalBudgets`, `totalVestingPositions`, `totalFundingRounds`,
  `totalPartners`, `totalFunds`, `totalEntities`, `totalFoundations`,
  `totalValueLocked`. Bumped from helpers in `fetch/metadata.ts`.
- **Feed** *(immutable)* — activity-feed item: `from: Account`,
  `activityType: String` (e.g. `"TRUST_CREATED"`), and optional `toTRUSTContract`,
  `toRole`, `toPartner` pointers. Created opportunistically by mappings.
- **Partner** *(mutable)* — `id: Bytes` (= account address). User-profile
  layer with `experience: BigInt`, `ipfsCid`, plus dense UniFutures trading
  metrics (`totalInvested`, `totalReturnedFromExits`,
  `totalReturnedFromBondingSells`, `totalCommitmentSalesInvested`,
  `totalBondingCurvesInvested`, `directTradingProfit`, `totalCommitmentSales`,
  `totalBondingCurves`, `totalExits`, `successfulExits`,
  `exitSuccessRate: BigDecimal`, `bondingCurveWins`,
  `bondingCurveSuccessRate: BigDecimal`, `firstTradeAt`, `lastTradeAt`,
  `tradingDays`).
- **Transaction** *(immutable)* (`schemas/interfaces/votes.graphql`) —
  `id`, `timestamp`, `blockNumber`, plus a derived `events: [Event!]`. Used as
  the join target for governance/erc20 events implementing the `Event`
  interface.
- **Event** *(interface, not a table)* — `id`, `transaction: Transaction!`,
  `emitter: Account!`, `timestamp: BigInt!`. Implementors:
  `ERC20Transfer`, `DelegateChanged`, `DelegateVotesChanged`,
  `ProposalCreated`, `ProposalSucceeded`, `ProposalExecuted`,
  `ProposalCanceled`, `VoteCast`.

### Factory & TRUST configuration (`schemas/factory.graphql`)

- **FactoryContract** *(immutable)* — singleton-ish; `id: Bytes`, `asAccount`,
  `createdAt`, derived `factoryConfig`, `trustContracts`, `trustConfigs`,
  `templates`, `signatures`. Root of every TRUST registration.
- **FactoryConfig** *(mutable)* — current beacon address pointed to by the
  factory.
- **TRUSTConfig** *(mutable)* — `id: Bytes` (= trustId hash). Pre-deployment
  config: `template`, `ipfsCid`, `trustStatus: Int` (1=registered, 2=approved,
  3=created), `threshold`, derived `signatures`, `valueConfigs`. Linked to
  the deployed `TRUSTContract` once `Factory_TRUSTCreatedEvent` fires.
- **Template** *(mutable)* — `id: Bytes` (= templateId hash); `ipfsCid`,
  `valueConfigs`, `moduleConfigs`. Four known template IDs are hard-coded in
  `factory-mapping.ts`: `venture`, `fund`, `entity`, `foundation`.
- **ValueConfig** *(mutable)* — typed key/value pair under a template or
  TRUSTConfig. `valueType: Int` discriminates uint/string/address/bytes/etc.
- **ModuleConfig** *(mutable)* — module slot in a template:
  `moduleId`, `moduleAddress`, `trustAclFlags: BigInt`,
  `moduleAclIds: [Bytes!]`, `moduleAclFlags: [BigInt!]`.
- **Signature** *(mutable)* — `id: Bytes` (= addressKey). Per-signer signing
  state on a TRUSTConfig: `signerAddress`, `hasSigned`, `ipfsCid`.

### TRUST runtime (`schemas/trust.graphql`)

- **TRUSTContract** *(mutable)* — root entity for a deployed TRUST instance.
  `id: Bytes` (= TRUST address). Holds `factoryContract`, `ipfsCid`,
  `beaconSource`, `moduleCount`, `activeModules`, `totalExecutions`,
  `totalBatchExecutions`, `totalFundsTransfers`, `totalValueLocked`,
  `deployedViaFactory`, `deploymentMethod`, plus typed pointers to every
  module-kind contract (`tokenContract`, `governanceContract`,
  `vestingContract`, `fundContract`, `roleContract`, `fundingContract`,
  `budgetContract`, `unifuturesContract`,
  `uniswapPositionManagerContract`, `unifuturesPositionManagerContract`).
- **TRUSTExecution** *(immutable)* — record of a single `TRUST_Executed`:
  `target`, `value`, `data`, `success`, block/tx metadata, `initiator`.
- **TRUSTBatchExecution** *(immutable)* — same for `TRUST_BatchExecuted`,
  with `targets[]`, `values[]`, `datas[]`, `successes[]`, `callCount`,
  `allSuccessful`.
- **TRUSTFundsTransfer** *(immutable)* — record of `TRUST_FundsTransferred`:
  `to`, `amount`, `asset`, plus `assetAccount` and `toAccount` Account refs.

### Module registry (`schemas/module.graphql`)

- **Module** *(mutable)* — generic module row, `id` =
  `<trustAddr>-<moduleId>`. Holds `moduleType: String` (one of `token`,
  `governance`, `vesting`, `fund`, `role`, `budget`, `funding`, `treasury`,
  `vault`, `unifutures`, `unifuturesPositionManager`,
  `uniswapPositionManager`, `unknown`), `moduleAddress`, `trustAclFlags`,
  `deployedAt`, `deployedBy`, `isActive`, `beaconSource`, plus a typed
  `as<Kind>Module` slot for every kind. Counts ACL edges via
  `outgoingAclCount` / `incomingAclCount`.
- **ModuleACL** *(mutable)* — directed edge between two modules:
  `fromModule`, `toModule`, `aclFlags`, `grantedAt`, `grantedBy`,
  `isActive`.
- **ModuleAddressIndex** *(mutable)* — `id: Bytes` (= module address) →
  `module`, `trust`. Reverse-lookup index because TheGraph can't query by
  scalar.
- **ModuleDeployment** *(immutable)* — one row per `TRUST_ModuleAdded` /
  `TRUST_ModuleDeployedWithConfig`: full deployment fingerprint.
- **ModuleStats** *(mutable, singleton id="module-stats")* — global counts
  per module kind plus `totalAclRelationships`.

### Beacon / proxy (`schemas/beacon.graphql`)

- **BeaconContract** *(mutable)* — beacon instance:
  `defaultDelegatedSource`, `owner`, derived `sources`, `implementations`,
  `totalSources`, `totalImplementations`, `totalModuleTypes`.
- **BeaconSource** *(mutable)* — per-TRUST source row (id = source address /
  TRUST address): `owner`, `previousOwners: [Bytes!]`, `delegatedSource`,
  `lastRefreshedAt`, `isActive`, `localOverrideCount`,
  `delegatedModuleCount`.
- **BeaconSourceModule** *(mutable)* — pinned implementation of one moduleId
  on one source: `isDelegated`, `version`, `currentImplementation`,
  `delegatedFromSource`, derived `implementationHistory`.
- **BeaconImplementation** *(immutable)* — one log of an implementation
  change: `implementation`, `version`, `changedBy`, `isLocalOverride`,
  `previousImplementation`, plus block/tx.
- **BeaconSourceOwnerTransfer** *(immutable)*, **BeaconDelegationChange**
  *(immutable)*, **BeaconRefreshEvent** *(immutable)* — append-only audit
  trails for source ownership, delegation churn, and refresh actions.
- **BeaconStats** *(mutable, singleton)* — totals across all beacon
  activity.

### Generic interfaces (`schemas/interfaces/`)

- **ERC20Contract** (interface) — implemented by `TokenContract` and
  `VestingContract`. Carries `contractType: String`
  (`"TOKEN"|"VESTING"|"EXIT"`), `config: ERC20Config`, `totalSupply`,
  derived `balances`, `transfers`, plus `trustContract: TRUSTContract!`.
- **ERC20Config** *(mutable)* — `symbol`, `name`, `decimals`, `supply`,
  `maxSupply`, `isTransferable`.
- **ERC20Balance** *(mutable)* — `(contract, account) → value`. Updated on
  every `Transfer`.
- **ERC20Transfer** *(immutable, implements Event)* — one row per ERC20
  transfer.
- **VotingContract** (interface) — `totalWeight`, derived `weight`,
  `delegation`, plus `delegateChangedEvent`, `delegateVotesChangedEvent`.
  Implemented by `TokenContract`, `VestingContract`.
- **VoteDelegation** *(mutable)* — `(contract, delegator, delegatee)` row.
- **VoteWeight** *(mutable)* — `(contract, account) → BigInt`.
- **DelegateChanged** *(immutable, implements Event)*,
  **DelegateVotesChanged** *(immutable, implements Event)* — wrappers around
  the OZ-style delegation events.
- **Governor** (interface) — implemented by `GovernanceContract`. Pulls in
  `proposals`, `proposalCreated/Succeeded/Executed/Canceled`, `votecast`.
- **Proposal** *(mutable)* — full lifecycle row: `proposalId`,
  `governanceConfigId`, `voteStart`, `voteEnd`, `ipfsCid`, `eta`,
  `canceled`, `succeeded`, `succeededAt`, `executed`, derived `calls`,
  `supports`, `receipts`.
- **ProposalCall** *(immutable)* — one targets/values/signature/calldata
  triple per proposal index.
- **ProposalSupport** *(mutable)* — per `(proposal, support)` running tally
  with `weight` and derived `votes`.
- **VoteReceipt** *(immutable)* — single voter's ballot.

### Per-module entities (`schemas/modules/*.graphql`)

- **Budget module** — **BudgetContract** *(immutable)* plus **Budget**
  *(mutable)*. Budget: `status: Int`, `statusSince`, `used`, `deposited`,
  `sourceBudget` (parent), `targetModuleId`, `targetRole`, `asset`,
  `amount`, `expiresAt`, `allowedPurposes: [Bytes!]`, plus spending-limit
  fields (`periodSpent`, `periodAllowance`, `periodDuration`,
  `periodStartTime`).
- **Funding module** — **FundingContract** *(immutable)*, **FundingConfig**
  *(mutable)*, **Funding** *(mutable)*. Funding row carries `fundingType:
  Int` (0=NULL, 1=ANGEL, 2=SEED, 3=BRIDGE, 4=SERIES, 5=EXIT), the resolved
  `unifuturesId`, and **five mutually-exclusive typed back-pointers** to the
  primitive it represents: `asCommitmentSale`, `asBondingCurve`, `asEntity`
  (TRUSTContract), `asFund` (TRUSTContract), `asExitSale`. The active
  pointer is selected by `fundingType` in
  `funding-mapping.ts:handleFundingCreated/Activated`.
- **Governance module** — **GovernanceContract** (implements `Governor`),
  **GovernanceConfig** *(mutable)*: `proposalThreshold`, `executionDelay`,
  `votingPeriod`, `quorumPercentage`, `supportPercentage`,
  `enactEarlyQuorumPercentage`, `enactEarlySupportPercentage`,
  `allowEarlyEnact`, `exists`. Governance does **not** have
  `RoleVotingPower` / `RoleDelegation`; those are role-module specific.
- **Role module** — **RoleContract** *(immutable)*, **Role** *(mutable)*,
  **RoleAssignment** *(mutable)*, **RoleTypeConfig** *(mutable)*,
  **RoleDelegation** *(mutable)*, **RoleVotingPower** *(mutable)*. Role:
  `id` = `<trustAddr>@<roleId>`, `parentRole` (self-reference for the org-
  chart DAG), `account` (current occupant), `delegatedTo`, `roleType`,
  `ipfsCid`, derived `vestingPositions`, `budgets`, `roleAssignments`,
  `delegation`. RoleTypeConfig: `hierarchy`, `probationaryPeriod`,
  `severancePeriod`, `vesting`, `fdv`, `contribution`, `vestingCliff`,
  `vestingDuration`, `fdvStart`, `fdvEnd`.
- **Token module** — **TokenContract** *(mutable, implements
  ERC20Contract+VotingContract)*. Lifecycle: `contractType` flips from
  `"TOKEN"` to `"EXIT"` and `exitSale: Exit` is set when `Token_EXIT`
  fires. **TokenAllocation** *(mutable)*: per-config target allocation
  (`targetModuleId`, `targetAccount`, `amount`).
- **Vesting module** — **VestingContract** *(immutable, implements
  ERC20Contract+VotingContract, contractType="VESTING")*, **VestingPosition**
  *(mutable)*: `claimed`, `sourceBudget`, `targetRole`, `asset`, `amount`,
  `ipfsCid`, plus the full role-type config snapshot inlined (`fdv`,
  `fdvStart`, `fdvEnd`, `vesting`, `vestingCliff`, `vestingDuration`,
  `probationaryPeriod`, `severancePeriod`, `contribution`,
  `contributionAsset`, `contributionAmount`).
- **Fund module** (the heaviest schema, 319 lines) —
  **FundContract** *(immutable)*, **FundConfig** *(mutable)*, **FundState**
  *(mutable)*, **FlowRequest** *(mutable)*, **NavCheckpoint** *(immutable)*,
  **Book** *(mutable)*, **FundPosition** *(mutable)*, **FundEvent**
  *(immutable)*, **FundStats** *(mutable, singleton)*. FundState is the
  live-accounting row (queued deposits/redemptions, accrued and claimable
  fees, cumulative totals). NavCheckpoint snapshots are the historical
  audit trail; Book is per-GP performance tracking with high-water-mark
  carry; FundPosition tracks position accounting; FundEvent is a typed
  generic event log (15 distinct `eventType` strings). `FundStats` carries
  aggregate metrics across NAV / flows / positions / books / fees /
  capital / participants.
- **UniFutures module** —
  **UnifuturesContract** *(immutable)*, **UnifuturesConfig** *(mutable)*
  with three fee ppm fields, **CommitmentSale** *(mutable)*, **BondingCurve**
  *(mutable)*, **Exit** *(mutable)*, **CommitmentParticipant**,
  **BondingParticipant**, **ExitParticipant**, **UnifuturesLiquidityRequest**,
  **UnifuturesStats** *(mutable, singleton)*. Each primitive (sale / curve /
  exit) has the same status enum (`0..5`) and the same accounting shape
  (`feesCollected`, `proceedsCollected`, plus type-specific fields). Exit
  carries an explicit `exitToken: TokenContract!` reference and a
  `funding: Funding` back-pointer set bidirectionally.
- **UniswapPositionManager module** —
  **UniswapPositionManagerContract** *(immutable)*,
  **UniswapPositionManagerConfig** *(mutable)*, **UniswapPosition**
  *(mutable, state ∈ {0=SWAP, 1=LP})*, **UniswapPositionEvent**
  *(immutable, 10+ eventType strings)*, **UniswapPool** *(mutable, id =
  poolId)*, **UniswapPositionManagerStats** *(singleton)*.
- **UnifuturesPositionManager module** —
  **UnifuturesPositionManagerContract** *(immutable)*,
  **UnifuturesPositionManagerConfig** *(mutable)*, **UnifuturesPosition**
  *(mutable, state ∈ {0..3} = COMMITTED/VESTING/HOLDING_TOKENS/DIRECTOR,
  primitiveType ∈ COMMITMENT/CURVE/EXIT/DEPOSIT)*,
  **UnifuturesPositionEvent** *(immutable, 6 eventType strings)*,
  **UnifuturesPositionManagerStats** *(singleton)*.

---

## 2. Subgraph event handlers

The complete event→handler wiring is in `subgraph.template.yaml` (lines
60–605). Below is the inventory grouped by data source. Format:
**event signature → handler → behavior**.

### Factory (`src/factory-mapping.ts`)

| Event | Handler | Behavior |
|---|---|---|
| `Factory_FactoryConfigSet(indexed address)` | `handleFactoryConfigSet` | Upsert FactoryContract + FactoryConfig with current beacon address. |
| `Factory_TRUSTRegisteredEvent(address, bytes32, bytes32, bytes, uint256, uint256)` | `handleTRUSTRegistered` | Read full struct via `Factory.getTRUSTConfig`, upsert TRUSTConfig + all ValueConfig children, bump partner experience +10, bump `Metadata.totalTRUSTConfigs`. |
| `Factory_TRUSTSignerAdded(bytes32, bytes32, address, bool)` | `handleTRUSTSignerAdded` | Upsert Signature row keyed by `addressKey`. |
| `Factory_TRUSTApprovedEvent(bytes32, bytes32, address, bytes, bool)` | `handleTRUSTApproved` | Mark signature `hasSigned=true`; if `isTRUSTApproved`, set `TRUSTConfig.trustStatus=2`. Bump partner +5. |
| `Factory_TRUSTCreatedEvent(address, bytes32, address)` | `handleTRUSTCreated` | Spawn `TRUST` template at the new TRUST address; create TRUSTContract; link TRUSTConfig→TRUSTContract (status=3); link beaconSource if present; bump partner +100; create Feed `TRUST_CREATED`; bump per-template metadata counter (`totalVentures`/`totalFunds`/`totalEntities`/`totalFoundations`) by hard-coded template-id match. |
| `Factory_TemplateReplaced(bytes32)` | `handleTemplateReplaced` | Refetch `Factory.getTemplate`, replace ValueConfig+ModuleConfig children for the template. |
| `Factory_PartnerProfileSet(bytes)` | `handlePartnerProfileSet` | Upsert Partner with `ipfsCid`. |

### Beacon (`src/beacon-mapping.ts`)

| Event | Handler | Behavior |
|---|---|---|
| `ImplementationChanged(address, bytes32, address)` | `handleImplementationChanged` | Catch-all: ensure BeaconSource + BeaconSourceModule exist, append BeaconImplementation row, bump version + counters. |
| `DelegatedSourceChanged(address, address)` | `handleDelegatedSourceChanged` | Update `BeaconSource.delegatedSource`, log a BeaconDelegationChange. |
| `SourceOwnerTransferred(address, address, address)` | `handleSourceOwnerTransferred` | Push prev owner to `previousOwners[]`, set new owner, log BeaconSourceOwnerTransfer. |
| `LocalImplementationSet(address, bytes32, address)` | `handleLocalImplementationSet` | Upsert as a local-override BeaconImplementation, bump `localOverrideCount`. |
| `LocalOverrideRemoved(address, bytes32)` | `handleLocalOverrideRemoved` | Decrement `localOverrideCount`, mark module non-overridden. |
| `DelegationRefreshed(address, bytes32)` | `handleDelegationRefreshed` | Append BeaconRefreshEvent for one moduleId. |
| `AllDelegationsRefreshed(address)` | `handleAllDelegationsRefreshed` | Append BeaconRefreshEvent with `moduleId=null` for the source. |
| `DelegatedImplementationSet(address, bytes32, address, address)` | `handleDelegatedImplementationSet` | Upsert as a delegated BeaconImplementation, set `delegatedFromSource`. |
| `IdChanged(bytes32, bytes32)` | `handleIdChanged` | Beacon-id mutation; updates BeaconContract id field. |
| `SourceChanged(address, address)` | `handleSourceChanged` | Beacon-source mutation; updates `BeaconContract.defaultDelegatedSource`. |

### TRUST template (`src/trust-mapping.ts`)

| Event | Handler | Behavior |
|---|---|---|
| `TRUST_ModuleAdded(bytes32, address, uint256)` | `handleModuleAdded` | Resolve moduleType via `getModuleType(moduleId)`, init Module via `initializeModule`, dispatch to per-kind handler via `getModuleHandler` (creates the corresponding `<Kind>Contract` entity and spawns the `<Kind>` template), append ModuleDeployment, bump TRUSTContract counters. |
| `TRUST_ModuleDeployedWithConfig(bytes32, address, uint256)` | `handleModuleDeployedWithConfig` | Identical body to `handleModuleAdded` (parameters are the same shape). |
| `TRUST_ModuleRemoved(bytes32)` | `handleModuleRemoved` | Mark Module `isActive=false`, decrement ModuleStats and TRUSTContract.activeModules. |
| `TRUST_SetAclBetweenModules(bytes32, address)` | `handleSetAclBetweenModules` | Upsert ModuleACL edge between fromModule and toModule (via ModuleAddressIndex lookup). |
| `TRUST_SetNumericConfig/SetAddressConfig/SetStringConfig/SetBytesConfig/SetInverseAddressConfig(bytes32, bytes32, T)` | `handleSetNumericConfig` etc. | Upsert ValueConfig entries against the TRUST. |
| `TRUST_ImplementationsRefreshed(uint256)` | `handleImplementationsRefreshed` | Bump `TRUSTContract.updatedAt`. |
| `TRUST_FundsTransferred(address, uint256, address)` | `handleFundsTransferred` | Append TRUSTFundsTransfer, bump `totalFundsTransfers`. |
| `TRUST_Executed(address, uint256, bytes, bool)` | `handleExecuted` | Append TRUSTExecution, bump `totalExecutions`. |
| `TRUST_BatchExecuted(address[], uint256[], bytes[], bool[])` | `handleBatchExecuted` | Append TRUSTBatchExecution, compute `allSuccessful`, bump `totalBatchExecutions`. |
| `TRUST_Paused(address)` / `TRUST_Unpaused(address)` | `handlePaused` / `handleUnpaused` | Stamp `updatedAt`. (No paused flag stored.) |
| `TRUST_Finalized(uint256)` | `handleFinalized` | Stamp finalization time on TRUSTContract. |

### Governance template (`src/modules/governance-mapping.ts`)

| Event | Handler |
|---|---|
| `Governance_ConfigSet(bytes32)` | `handleSetGovernanceConfig` — fetches struct via contract call, upserts GovernanceConfig. |
| `Governance_ProposalCreated(uint256, bytes32, address, address[], uint256[], string[], bytes[], uint256, uint256, bytes)` | `handleProposalCreated` — creates Proposal + N ProposalCall rows + ProposalCreated event. |
| `Governance_ProposalSucceeded(uint256)` | `handleProposalSucceeded` — sets `succeeded=true`, `succeededAt`. |
| `Governance_ProposalExecuted(uint256)` | `handleProposalExecuted` — sets `executed=true`. |
| `Governance_ProposalCanceled(uint256)` | `handleProposalCanceled` — sets `canceled=true`. |
| `Governance_VoteCast(address, uint256, uint8, uint256, string)` | `handleVoteCast` — upsert ProposalSupport, append VoteReceipt + VoteCast. |
| `Governance_VoteCastWithParams(address, uint256, uint8, uint256, string, bytes)` | `handleVoteCastWithParams` — same as VoteCast but stores `params`. |

`Governance_Reset()` is declared in the contract but **not handled**.

### Token template (`src/modules/token-mapping.ts`)

| Event | Handler |
|---|---|
| `Token_SetTokenConfig()` | `handleSetTokenConfig` — refetch ERC20Config via contract call. |
| `Token_AllocationTransferred(address, bytes32, address, uint256)` | `handleTokenAllocationTransferred` — upsert TokenAllocation row. |
| `Transfer(address, address, uint256)` (ERC20) | `handleTransfer` — debit `from` ERC20Balance, credit `to` ERC20Balance, append ERC20Transfer (which implements `Event`). Mints/burns adjust `totalSupply`. |
| `DelegateChanged(address, address, address)` | `handleDelegateChanged` — upsert VoteDelegation, append DelegateChanged event. |
| `DelegateVotesChanged(address, uint256, uint256)` | `handleDelegateVotesChanged` — upsert VoteWeight, append DelegateVotesChanged. |
| `Token_Reset()` | `handleTokenReset` (no-op). |
| `Token_EXIT()` | `handleTokenExit` — flip `TokenContract.contractType` from `"TOKEN"` to `"EXIT"`, set `exitedAt`. |

### Vesting template (`src/modules/vesting-mapping.ts`)

Handles `Vesting_SetVestingConfig`, `Vesting_VestingPositionCreated`,
`Vesting_VestingPositionActivated`, `Vesting_VestingPositionsTransferred`,
`Vesting_VestingPositionContributed`, `Vesting_VestingClaimed`,
`Vesting_PositionRemoved` (handler name `handleVestingPositionRemoved`),
plus the same `Transfer / DelegateChanged / DelegateVotesChanged` triple
as Token (because VestingContract is also an ERC20+Voting contract).
`Vesting_Reset()` is **not handled**.

### Fund template (`src/modules/fund-mapping.ts`)

15 event handlers. Each one (a) upserts FundContract / FundConfig /
FundState as needed via contract calls, (b) appends a typed FundEvent row
with the same `(txHash + logIndex)` id pattern, (c) bumps FundStats
counters. Notable behavior:

- `Fund_FlowRequested` upserts FlowRequest in `PENDING`.
- `Fund_FlowCancelled` flips status to `CANCELLED`.
- `Fund_FlowClaimed` flips to `SETTLED` and writes `amountOut`.
- `Fund_NavProcessed` appends NavCheckpoint, bumps cumulative counters
  in FundState.
- `Fund_BookProcessed` upserts the per-GP Book row.
- `Fund_PositionOpened/Interacted/Closed` mutate FundPosition lifecycle.
- `Fund_LPRoleClaimed`, `Fund_ManagerCarryClaimed`, `Fund_MgmtFeesClaimed`,
  `Fund_TrustCarryClaimed` each just stamp the relevant Book / FundState
  field and append a FundEvent.

### Role template (`src/modules/role-mapping.ts`)

16 handlers covering the full role lifecycle (`Created`, `Assigned`,
`Resigned`, `Removed`, `AssignmentStatusUpdated`, `TypeConfigSet`,
`VestingPositionAdded/Removed`, `BudgetAdded/Removed`, `Delegated`,
`Transferred`, `Updated`, `VotingPowerChanged`, `Reset`). Notable:

- Role IDs are composite (`<trustAddr>@<roleId>`) and `parentRole` is
  resolved by recomposing the same composite from the parent's bytes32.
- `handleRoleAssigned` recomputes the contract's `addressKey` via
  `keccak256(abi.encode(roleId, keccak256(abi.encode(account))))` to
  upsert the matching RoleAssignment to `ACCEPTED`.
- `handleVotingPowerChanged` upserts RoleVotingPower keyed by
  `(roleContract, account, roleType)`.

### Budget template (`src/modules/budget-mapping.ts`)

The manifest only wires **5 of the 9** Budget events:
`Budget_BudgetCreated`, `Budget_BudgetFrozen`, `Budget_BudgetRemoved`,
`Budget_BudgetConsumed`, `Budget_BudgetDeposited`. Handler functions for
`Budget_BudgetUnfrozen`, `Budget_BudgetReturned`, `Budget_BudgetTransferred`,
`Budget_Reset` exist in `budget-mapping.ts` but are not registered in
`subgraph.template.yaml` — see section 5.

Each handled event upserts the Budget row, mutates `status` /
`statusSince` / `used` / `deposited` accordingly, and writes
metadata.totalBudgets on creation.

### Funding template (`src/modules/funding-mapping.ts`)

`Funding_SetFundingConfig`, `Funding_FundingCreated`,
`Funding_FundingRemoved`, `Funding_FundingActivated`,
`Funding_FinalizedFunding`, `Funding_ExitExecuted`. The two
`Created/Activated` handlers do the heavy lifting:

1. Read full Funding struct via `Funding.getFunding(fundingId)`.
2. Read `FundingConfig.unifuturesModule` and compose
   `<unifuturesModule>-<unifuturesId>` as the primitive ID.
3. Set exactly one of `asCommitmentSale`, `asBondingCurve`, `asEntity`,
   `asFund`, `asExitSale` based on `fundingType`.
4. For EXIT, also set `Exit.funding = <fundingId>` for the bidirectional
   link.

`Funding_Reset()` is **not handled**.

### Foundation template (`src/modules/foundation-mapping.ts`)

`Foundation_SetFoundationConfig` only. **There is no `foundation.graphql`
schema and no `Foundation.module.sol` contract** in either repo — see
section 5.

### Unifutures template (`src/modules/unifutures-mapping.ts`, 1241 lines)

26 handlers, the largest mapping file. Pattern: each
`<Primitive><Verb>` event upserts the matching `CommitmentSale` /
`BondingCurve` / `Exit` row (often via contract `getX` view), upserts the
participant row, mutates status enums (`0..5`), updates UnifuturesStats
counters, and (when the user is a participant) calls
`updatePartnerUnifuturesStats(...)` to roll the partner's trading metrics.
Special cases:

- `handleConfigurationSet` reads three fee ppm fields via contract call.
- `handleBondingCurveExecuted` / `handleBondingCurveSold` track buy/sell
  volume and per-participant net token balance + buy/sell counts.
- `handleExitProceedsClaimed` flips `ExitParticipant.hasClaimed` and
  decrements `Exit.remainingProceeds`.
- `handleExitCreated` and `handleFundingActivated` cooperate via the
  bidirectional `Exit.funding` / `Funding.asExitSale` link (whichever
  fires first sets one side; the second sets the other).

### UniswapPositionManager (`src/managers/uniswapPositionManager-mapping.ts`)

11 handlers: `SetUniswapPositionConfig`, `SwapOpened`, `LPOpened`,
`Swapped`, `TransitionedToLP`, `TransitionedToSwap`, `Rebalanced`,
`Interacted`, `Closed`, `LiquidityInjected`, `PoolCreated`. Each upserts
a `UniswapPosition` (state machine: 0=SWAP, 1=LP), appends a
`UniswapPositionEvent` with eventType string, upserts `UniswapPool` on
`PoolCreated`, and bumps the singleton stats.

### UnifuturesPositionManager (`src/managers/unifuturesPositionManager-mapping.ts`)

6 handlers: `CommitmentOpened`, `CurveOpened`, `ExitOpened`, `Interacted`,
`Closed`, `ExitSaleCreated`. Same pattern as Uniswap manager but with the
4-state position machine
(COMMITTED/VESTING/HOLDING_TOKENS/DIRECTOR) and the
COMMITMENT/CURVE/EXIT/DEPOSIT primitiveType discriminator.

---

## 3. Subgraph helpers / utilities

`src/fetch/` — one file per entity kind. Each exposes a
`fetch<Kind>(...)` upsert that:

1. Loads the entity by id (= contract address for top-level contracts).
2. If null, creates it; if it's a contract entity, also calls `<X>.bind`,
   reads `try_getTRUST()` to populate `trustContract`, and links the
   typed slot back on `Account` (e.g. `Account.asTokenContract = address`).
3. Saves and returns the entity.

Notable cross-entity helpers:

- **`fetch/account.ts`** — `fetchAccount(address)` is the universal
  entry point; literally every other helper calls it.
- **`fetch/metadata.ts`** — singleton + a family of
  `handleNew<X>Added(timestamp)` functions that bump the matching counter
  and write `updatedAt`. Plus `updateTotalValueLocked(delta, ts)` for TVL
  aggregation (called from TRUST mappings).
- **`fetch/feed.ts`** — `createFeed(id, from, ts, activityType)` creates
  an immutable activity-feed row. Used today only by `handleTRUSTCreated`
  with `"TRUST_CREATED"`; the activityType field is open-ended for future
  use.
- **`fetch/partner.ts`** — `fetchPartner(addr, ts)` and
  `updatePartnerExperience(addr, +N, ts)` and the heavy
  `updatePartnerUnifuturesStats(...)` which recomputes
  `directTradingProfit`, success rates, first/last trade timestamps,
  and adds +10 experience per trade.
- **`fetch/governance.ts`** — `fetchGovernanceContract`, `fetchProposal`,
  `fetchProposalSupport`, `fetchVoteReceipt`. ID composition for proposal
  is `<governorAddr>/<proposalIdHex>`.
- **`fetch/token.ts` / `fetch/vesting.ts`** — fetch helpers that also
  initialize ERC20 totalSupply Balance row and totalWeight VoteWeight row
  on first creation (because both schemas implement ERC20Contract +
  VotingContract).

`src/helpers/` — three files:

- **`module-types.ts`** — hard-coded `keccak256` constants for the 12
  known module IDs (`TOKEN_MODULE_ID`, `GOVERNANCE_MODULE_ID`,
  `VESTING_MODULE_ID`, `FUND_MODULE_ID`, `ROLE_MODULE_ID`,
  `BUDGET_MODULE_ID`, `FUNDING_MODULE_ID`, `TREASURY_MODULE_ID`,
  `VAULT_MODULE_ID`, `UNIFUTURES_MODULE_ID`,
  `UNIFUTURES_POSITION_MANAGER_MODULE_ID`,
  `UNISWAP_POSITION_MANAGER_MODULE_ID`) plus `getModuleType(bytes)` →
  `string` and `is<Kind>Module(bytes)` predicates.
- **`module-init.ts`** — `getOrCreateModuleStats()`, `initializeModule()`
  (the canonical Module-row constructor used by both
  `TRUST_ModuleAdded` and `TRUST_ModuleDeployedWithConfig`),
  `createModuleDeployment()`, `deactivateModule()`. Also writes the
  ModuleAddressIndex used by ACL handlers.
- **`module-templates.ts`** — `getModuleHandler(moduleId)` →
  `ModuleHandler | null` dispatch table that, given a moduleId,
  (a) spawns the per-module dynamic template, (b) creates the
  `<Kind>Contract` entity, (c) sets the typed `Account.as<Kind>Contract`
  slot, (d) sets `Module.as<Kind>Contract`. This is the central
  fan-out from "TRUST added some module" to "register a new
  per-module event source".

ID composition conventions to mirror in the Rust indexer:

| Entity | ID format |
|---|---|
| Account, Contract entities | `Bytes` (raw address) |
| TRUSTConfig | `Bytes` (= trustId hash) |
| Template | `Bytes` (= templateId hash) |
| Module | `<trustAddr>-<moduleIdHex>` |
| ModuleACL / ModuleDeployment | `<txHash>-<logIndex>` |
| Role / RoleAssignment / Budget / VestingPosition / Funding | `<trustAddr>@<entityIdHex>` |
| RoleDelegation | `<roleContract>@<roleIdHex>@<delegator>` |
| RoleVotingPower | `<roleContract>@<account>@<roleType>` |
| FundConfig / FundState | `fund(Config\|State)@<fundContract>` |
| FundEvent / FundPosition / Book | `<fundContract>-<positionId\|roleId\|requestId>` |
| NavCheckpoint | `navCheckpoint-<fundContract>-<checkpointId>` |
| GovernanceConfig | `governanceConfig@<contract>@<configIdHex>` |
| Proposal | `<governorAddr>/<proposalIdHex>` |
| Unifutures primitives (CommitmentSale/BondingCurve/Exit) | `<unifuturesContract>-<primitiveIdHex>` |
| TRUSTExecution / TRUSTBatchExecution / TRUSTFundsTransfer | `<txHash>-<logIndex>` |
| ERC20Transfer / DelegateChanged etc. | `<txHash>-<logIndex>` |
| Singletons | `"global"` (FundStats, UnifuturesStats, …), `"module-stats"`, `"unifutures-stats"` |

---

## 4. Contract events (full enumeration)

All event interfaces live in
`aeqi-core/contracts/<area>/interfaces/events/I<X>.events.sol`. Below is
the verbatim signature list grouped by emitting contract. **Indexed**
flag matches the Solidity declaration. `[H]` = handled by the subgraph
manifest, `[h]` = handler exists in `.ts` but not wired in
`subgraph.template.yaml`, `[—]` = not handled at all.

### `Beacon` (`core/interfaces/events/IBeacon.events.sol`)

- `[H] SourceChanged(address previousSource, address newSource)`
- `[H] IdChanged(bytes32 previousId, bytes32 newId)`
- `[H] ImplementationChanged(address source, bytes32 id, address implementation)`
- `[H] SourceOwnerTransferred(address source, address previousOwner, address newOwner)`
- `[H] DelegatedSourceChanged(address source, address newDelegatedSource)`
- `[H] LocalImplementationSet(address indexed source, bytes32 indexed moduleId, address implementation)`
- `[H] LocalOverrideRemoved(address indexed source, bytes32 indexed moduleId)`
- `[H] DelegationRefreshed(address indexed source, bytes32 indexed moduleId)`
- `[H] AllDelegationsRefreshed(address indexed source)`
- `[H] DelegatedImplementationSet(address indexed source, bytes32 indexed moduleId, address implementation, address delegatedFromSource)`

### `Beacon proxy` (`proxy/interfaces/events/IBeacon.proxy.events.sol`)

- `[—] SourceChanged(address previousSource, address newSource)` — duplicate name with the beacon event but emitted by the proxy.
- `[—] IdChanged(bytes32 previousId, bytes32 newId)` — same.
- `[—] BeaconChanged(address beacon)` — never indexed.

### `Factory` (`core/interfaces/events/IFactory.events.sol`)

- `[H] Factory_FactoryConfigSet(address indexed beaconAddress)`
- `[H] Factory_TRUSTRegisteredEvent(address indexed creatorAddress, bytes32 indexed trustId, bytes32 indexed templateId, bytes ipfsCid, uint256 signersCount, uint256 valueConfigsCount)`
- `[H] Factory_TRUSTSignerAdded(bytes32 indexed trustId, bytes32 indexed addressKey, address indexed signerAddress, bool hasSigned)`
- `[H] Factory_TRUSTApprovedEvent(bytes32 indexed trustId, bytes32 indexed addressKey, address indexed signerAddress, bytes ipfsCid, bool isTRUSTApproved)`
- `[H] Factory_TRUSTCreatedEvent(address indexed creatorAddress, bytes32 indexed trustId, address indexed trustAddress)`
- `[H] Factory_TemplateReplaced(bytes32 indexed templateId)`
- `[H] Factory_PartnerProfileSet(bytes ipfsCid)`

### `TRUST` (`core/interfaces/events/ITRUST.events.sol`)

- `[H] TRUST_SetNumericConfig(bytes32 indexed key, bytes32 indexed id, uint256 value)`
- `[H] TRUST_SetAddressConfig(bytes32 indexed key, bytes32 indexed id, address value)`
- `[H] TRUST_SetStringConfig(bytes32 indexed key, bytes32 indexed id, string value)`
- `[H] TRUST_SetInverseAddressConfig(bytes32 indexed key, bytes32 indexed id, address value)`
- `[H] TRUST_SetBytesConfig(bytes32 indexed key, bytes32 indexed id, bytes value)`
- `[H] TRUST_ModuleAdded(bytes32 indexed moduleId, address indexed moduleAddress, uint256 moduleAcl)`
- `[H] TRUST_ModuleRemoved(bytes32 indexed moduleId)`
- `[H] TRUST_ModuleDeployedWithConfig(bytes32 indexed moduleId, address indexed moduleAddress, uint256 moduleAcl)`
- `[H] TRUST_SetAclBetweenModules(bytes32 indexed fromModuleId, address indexed toModuleAddress)`
- `[H] TRUST_Executed(address indexed to, uint256 value, bytes data, bool success)`
- `[H] TRUST_Paused(address indexed account)`
- `[H] TRUST_Unpaused(address indexed account)`
- `[H] TRUST_Finalized(uint256 indexed timestamp)`
- `[H] TRUST_ImplementationsRefreshed(uint256 indexed timestamp)`
- `[H] TRUST_FundsTransferred(address indexed to, uint256 amount, address indexed asset)`
- `[H] TRUST_BatchExecuted(address[] targets, uint256[] values, bytes[] datas, bool[] successes)`

### `Budget.module` (`modules/interfaces/events/IBudget.module.events.sol`)

- `[H] Budget_BudgetCreated(bytes32 indexed budgetId)`
- `[H] Budget_BudgetFrozen(bytes32 indexed budgetId)`
- `[h] Budget_BudgetUnfrozen(bytes32 indexed budgetId)` — handler exists, **not wired** in manifest.
- `[H] Budget_BudgetRemoved(bytes32 indexed budgetId)`
- `[H] Budget_BudgetConsumed(bytes32 indexed budgetId, uint256 amount, address indexed to, address indexed asset)`
- `[H] Budget_BudgetDeposited(bytes32 indexed budgetId, uint256 amount, address indexed from, address indexed asset)`
- `[h] Budget_BudgetReturned(bytes32 indexed budgetId, uint256 amount, address indexed asset)` — handler exists, **not wired**.
- `[h] Budget_BudgetTransferred(bytes32 indexed budgetId, bytes32 indexed newTargetRoleId, bytes32 indexed newTargetModuleId)` — handler exists, **not wired**.
- `[h] Budget_Reset()` — handler exists, **not wired**.

### `Funding.module` (`modules/interfaces/events/IFunding.module.events.sol`)

- `[H] Funding_SetFundingConfig()`
- `[H] Funding_FundingCreated(bytes32 indexed fundingId)`
- `[H] Funding_FundingRemoved(bytes32 indexed fundingId)`
- `[H] Funding_FundingActivated(bytes32 indexed fundingId)`
- `[H] Funding_FinalizedFunding(bytes32 indexed fundingId)`
- `[H] Funding_ExitExecuted(bytes32 indexed exitId)`
- `[—] Funding_Reset()` — not handled.

### `Fund.module` (`modules/interfaces/events/IFund.module.events.sol`)

- `[H] Fund_SetFundConfig()`
- `[H] Fund_FlowRequested(bytes32 indexed requestId, bytes32 indexed roleId, uint8 flowType, uint256 amountIn)`
- `[H] Fund_FlowCancelled(bytes32 indexed requestId)`
- `[H] Fund_FlowClaimed(bytes32 indexed requestId, uint256 amountOut)`
- `[H] Fund_NavProcessed(uint64 indexed checkpointId, uint256 netNAV, uint256 tokenQuote, uint256 mgmtFeesCharged, uint256 carryCharged)`
- `[H] Fund_ManagerCarryClaimed(bytes32 indexed roleId, uint256 amount)`
- `[H] Fund_BookProcessed(bytes32 indexed roleId)`
- `[H] Fund_MgmtFeesClaimed(bytes32 indexed roleId, uint256 amount)`
- `[H] Fund_TrustCarryClaimed(bytes32 indexed roleId, uint256 amount)`
- `[H] Fund_Paused()`
- `[H] Fund_Unpaused()`
- `[H] Fund_LPRoleClaimed(bytes32 indexed roleId)`
- `[H] Fund_PositionOpened(bytes32 indexed positionId, bytes32 indexed positionManagerId)`
- `[H] Fund_PositionInteracted(bytes32 indexed positionId, bytes32 indexed roleId, uint8 action)`
- `[H] Fund_PositionClosed(bytes32 indexed positionId, uint256 quoteAssetReceived)`

### `Governance.module` (`modules/interfaces/events/IGovernance.module.events.sol`)

- `[H] Governance_ConfigSet(bytes32 indexed configId)`
- `[H] Governance_ProposalCreated(uint256 indexed proposalId, bytes32 indexed governanceConfigId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 voteStart, uint256 voteEnd, bytes ipfsCid)`
- `[H] Governance_ProposalCanceled(uint256 indexed proposalId)`
- `[H] Governance_ProposalSucceeded(uint256 indexed proposalId)`
- `[H] Governance_ProposalExecuted(uint256 indexed proposalId)`
- `[H] Governance_VoteCast(address indexed voter, uint256 indexed proposalId, uint8 support, uint256 weight, string reason)`
- `[H] Governance_VoteCastWithParams(address indexed voter, uint256 indexed proposalId, uint8 support, uint256 weight, string reason, bytes params)`
- `[—] Governance_Reset()` — not handled.

### `Role.module` (`modules/interfaces/events/IRole.module.events.sol`)

- `[H] Role_RoleCreated(bytes32 indexed roleId, address indexed creator)`
- `[H] Role_RoleAssigned(bytes32 indexed roleId, address indexed occupant)`
- `[H] Role_RoleResigned(bytes32 indexed roleId, address indexed occupant)`
- `[H] Role_RoleRemoved(bytes32 indexed authorizedRoleId, bytes32 indexed roleId, address indexed account)`
- `[H] Role_RoleAssignmentStatusUpdated(bytes32 indexed roleId, address indexed account, bytes32 indexed addressKey, bytes ipfsCid, uint8 status)`
- `[H] Role_RoleTypeConfigSet(bytes32 indexed roleType)`
- `[H] Role_RoleVestingPositionAdded(bytes32 indexed roleId, address indexed occupant, bytes32 indexed vestingPositionId)`
- `[H] Role_RoleVestingPositionRemoved(bytes32 indexed authorizedRoleId, bytes32 indexed roleId, bytes32 indexed vestingPositionId)`
- `[H] Role_RoleBudgetAdded(bytes32 indexed roleId, bytes32 indexed budgetId)`
- `[H] Role_RoleBudgetRemoved(bytes32 indexed authorizedRoleId, bytes32 indexed roleId, bytes32 indexed budgetId)`
- `[H] Role_RoleDelegated(bytes32 indexed roleId, address indexed delegator, address indexed delegatee)`
- `[H] Role_RoleTransferred(bytes32 indexed roleId, address indexed oldHolder, address indexed newHolder)`
- `[H] Role_RoleUpdated(bytes32 indexed roleId, bytes32 indexed parentRoleId, bytes ipfsCid)`
- `[H] Role_VotingPowerChanged(address indexed account, bytes32 indexed roleType, uint256 newVotingPower)`
- `[H] Role_Reset()`

### `Token.module` (`modules/interfaces/events/IToken.module.events.sol`) + ERC20 base

- `[H] Token_AllocationTransferred(address indexed targetAddress, bytes32 indexed targetModuleId, address indexed targetAccount, uint256 amount)`
- `[H] Token_SetTokenConfig()`
- `[H] Token_Reset()`
- `[H] Token_EXIT()`
- `[H] Transfer(address indexed from, address indexed to, uint256 value)` (inherited ERC20)
- `[H] DelegateChanged(address indexed delegator, address indexed fromDelegate, address indexed toDelegate)` (inherited from `IERC20.util.events.sol`)
- `[H] DelegateVotesChanged(address indexed delegate, uint256 previousBalance, uint256 newBalance)` (inherited)
- `[—] StorageVersionUpdated(uint40 indexed oldVersion, uint40 indexed newVersion)` — emitted by ERC20 storage layer; not indexed.
- `[—] ERC20_TransferabilityChanged(bool isTransferable)` — not indexed.

### `Vesting.module` (`modules/interfaces/events/IVesting.module.events.sol`)

- `[H] Vesting_SetVestingConfig()`
- `[H] Vesting_VestingPositionCreated(bytes32 indexed vestingPositionId)`
- `[H] Vesting_VestingPositionActivated(bytes32 indexed vestingPositionId)`
- `[H] Vesting_VestingPositionsTransferred(bytes32 indexed vestingPositionId, address indexed from, address indexed to)`
- `[H] Vesting_PositionRemoved(bytes32 indexed vestingPositionId)`
- `[H] Vesting_VestingPositionContributed(bytes32 indexed vestingPositionId, address indexed contributor, uint256 amount)`
- `[H] Vesting_VestingClaimed(bytes32 indexed vestingPositionId, address indexed claimer, address indexed asset, uint256 amount)`
- `[—] Vesting_Reset()` — not handled.
- Plus inherited ERC20 `Transfer / DelegateChanged / DelegateVotesChanged`, all `[H]`.

### `Unifutures.module` (`modules/interfaces/events/IUnifutures.module.events.sol`)

All 27 events are **handled**:

- `[H] Unifutures_ConfigurationSet()`
- `[H] Unifutures_CommitmentSaleCreated(bytes32 indexed saleId, address indexed creator, uint256 amount)`
- `[H] Unifutures_BondingCurveCreated(bytes32 indexed curveId, address indexed creator, uint256 basePrice)`
- `[H] Unifutures_ExitCreated(bytes32 indexed exitId, address indexed creator, uint256 exitPrice)`
- `[H] Unifutures_CommitmentSaleRemoved(bytes32 indexed saleId)`
- `[H] Unifutures_BondingCurveRemoved(bytes32 indexed curveId)`
- `[H] Unifutures_ExitRemoved(bytes32 indexed exitId)`
- `[H] Unifutures_CommitmentSaleCancelled(bytes32 indexed saleId)`
- `[H] Unifutures_BondingCurveCancelled(bytes32 indexed curveId)`
- `[H] Unifutures_ExitCancelled(bytes32 indexed exitId)`
- `[H] Unifutures_CommitmentSaleCompleted(bytes32 indexed saleId, uint256 proceeds, uint256 fees)`
- `[H] Unifutures_CommitmentSaleFailed(bytes32 indexed saleId, uint256 raised, uint256 softCap)`
- `[H] Unifutures_BondingCurveFinalized(bytes32 indexed curveId, uint256 proceeds, uint256 fees)`
- `[H] Unifutures_ExitCompleted(bytes32 indexed exitId, uint256 proceeds, uint256 fees)`
- `[H] Unifutures_CommitmentMade(bytes32 indexed saleId, address indexed user, uint256 amount, uint256 totalCommitment)`
- `[H] Unifutures_TokensClaimed(bytes32 indexed saleId, address indexed user, uint256 amount)`
- `[H] Unifutures_RefundClaimed(bytes32 indexed saleId, address indexed user, uint256 amount)`
- `[H] Unifutures_ExcessRefunded(bytes32 indexed saleId, address indexed user, uint256 amount)`
- `[H] Unifutures_BondingCurveExecuted(bytes32 indexed curveId, address indexed buyer, uint256 assetAmount, uint256 quoteAmount, uint256 price)`
- `[H] Unifutures_BondingCurveSold(bytes32 indexed curveId, address indexed seller, uint256 assetAmount, uint256 quoteAmount, uint256 price)`
- `[H] Unifutures_BondingCurveCountdownCommitment(bytes32 indexed curveId, address indexed participant, uint256 amount)`
- `[H] Unifutures_ExitExecuted(bytes32 indexed exitId, address indexed buyer, uint256 quoteAmount)`
- `[H] Unifutures_ExitFinalized(bytes32 indexed exitId, uint256 totalProceeds)`
- `[H] Unifutures_ExitProceedsClaimed(bytes32 indexed exitId, address indexed recipient, uint256 amount)`
- `[H] Unifutures_TokensBurned(bytes32 indexed exitId, address indexed burner, uint256 amount)`
- `[H] Unifutures_LiquidityCreated(bytes32 indexed id, bytes32 indexed poolId)`
- `[H] Unifutures_FeesCollected(address indexed asset, uint256 amount, address indexed trust)`

### `UniswapPositionManager.module` (`managers/interfaces/events/IUniswapPositionManager.module.events.sol`)

All 11 events are **handled**:

- `[H] UniswapPosition_SetUniswapPositionConfig()`
- `[H] UniswapPosition_SwapOpened(bytes32 indexed positionId)`
- `[H] UniswapPosition_LPOpened(bytes32 indexed positionId)`
- `[H] UniswapPosition_Swapped(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut)`
- `[H] UniswapPosition_TransitionedToLP(bytes32 indexed positionId)`
- `[H] UniswapPosition_TransitionedToSwap(bytes32 indexed positionId)`
- `[H] UniswapPosition_Rebalanced(bytes32 indexed positionId)`
- `[H] UniswapPosition_Interacted(bytes32 indexed positionId, uint8 action)`
- `[H] UniswapPosition_Closed(bytes32 indexed positionId, uint256 quoteAssetReceived)`
- `[H] UniswapPosition_LiquidityInjected(bytes32 indexed positionId)`
- `[H] UniswapPosition_PoolCreated(bytes32 indexed poolId, address indexed token0, address indexed token1)`

### `UnifuturesPositionManager.module` (`managers/interfaces/events/IUnifuturesPositionManager.module.events.sol`)

All 6 events are **handled**:

- `[H] UnifuturesPosition_CommitmentOpened(bytes32 indexed positionId, address indexed trustToken, uint256 amount)`
- `[H] UnifuturesPosition_CurveOpened(bytes32 indexed positionId, address indexed trustToken, uint256 amount)`
- `[H] UnifuturesPosition_ExitOpened(bytes32 indexed positionId, address indexed trustToken, uint256 amount)`
- `[H] UnifuturesPosition_Interacted(bytes32 indexed positionId, uint8 action)`
- `[H] UnifuturesPosition_Closed(bytes32 indexed positionId, uint256 quoteAssetReceived)`
- `[H] UnifuturesPosition_ExitSaleCreated(bytes32 indexed positionId, uint256 exitQuote)`

### Cross-cutting (utils)

- `[—] OwnershipTransferred(address indexed previousOwner, address indexed newOwner)` (`IOwnable.util.events.sol`) — emitted by every Ownable contract; not indexed today.
- `[—] SlotArrays_IdSaved / IdRemoved / AccessKeyRemoved` (`ISlotArrays.util.storage.events.sol`) — internal storage primitive; not indexed.

---

## 5. Cross-references and gotchas

**Foundation: schema/handler exists, contract does not.**
`src/modules/foundation-mapping.ts` and `src/fetch/foundation.ts`
reference `FoundationContract` / `FoundationConfig` /
`Foundation_SetFoundationConfig` template event. There is **no
`schemas/modules/foundation.graphql`** and **no
`contracts/modules/Foundation.module.sol`**. The composite
`schema.graphql` does have a `FoundationContract` block (added by hand to
the composite), but it's not in any partial schema. The Rust indexer
should treat foundation as an aspirational template — drop or stub.

**Vesting handler imports a non-existent event.**
`vesting-mapping.ts` imports `Vesting_VestingPositionRemoved` to handle
it under a different name than the contract emits
(`Vesting_PositionRemoved`). The manifest wires
`Vesting_PositionRemoved → handleVestingPositionRemoved`. Verify the
import maps to the same selector — the contract event is canonical.

**Budget: 4 events emitted, not wired in subgraph.yaml.**
`Budget_BudgetUnfrozen`, `Budget_BudgetReturned`,
`Budget_BudgetTransferred`, and `Budget_Reset` have implemented handlers
but no eventHandler entry in `subgraph.template.yaml`. The Rust indexer
should index all five (Created/Frozen/Unfrozen/Removed/Consumed/Deposited/
Returned/Transferred) plus optionally the Reset signal.

**`*_Reset()` events are uniformly ignored.** Token_Reset is wired but
no-op; Vesting_Reset / Funding_Reset / Governance_Reset / Budget_Reset
have no manifest entry. These appear to be dev-only "wipe state" events
emitted on module re-initialization. Decide whether to index them as
audit log or drop.

**`SourceChanged` / `IdChanged` are emitted by both `Beacon` and
`Beacon.proxy`.** The subgraph wires only the Beacon-side
declarations. Rust indexer must distinguish by contract address (i.e. the
emitting log address) before dispatching.

**Bidirectional Funding ↔ UniFutures-primitive linking.**
`funding-mapping.ts` writes `asCommitmentSale` / `asBondingCurve` /
`asEntity` / `asFund` / `asExitSale` based on `fundingType`. For EXIT it
also sets `Exit.funding` back-pointer if the Exit row exists. Order of
event arrival matters: the second handler (whichever fires later) needs
to backfill the relation. The Rust indexer needs the same dual-write
pattern or a deferred-link queue.

**Module type dispatch is keccak-id-driven.** The 12 hard-coded
`<MODULE>_MODULE_ID` constants in `module-types.ts` (and duplicated in
`module-templates.ts`) are the keccak256 of each module's canonical
name. They MUST match what the contracts emit in
`TRUST_ModuleAdded.moduleId`. If the contracts ever rename a module, this
table breaks silently. Source these from a shared constants file in the
Rust port.

**Composite IDs use `@`, `-`, `/`, mixed.** No single separator
convention. The Rust indexer should pick one and migrate; current mix:
- `<addr>-<bytes32>` for Module, primitive, position
- `<addr>@<bytes32>` for Role, RoleAssignment, Budget, VestingPosition, Funding
- `<addr>/<bytes32>` for Proposal
- `<addr>@<key>` for FundConfig/FundState
- prefixed (`book-…`, `position-…`, `navCheckpoint-…`) for Fund children

**Multi-block / cross-handler aggregation.**
- `Metadata` and the per-module `*Stats` singletons (`module-stats`,
  `unifutures-stats`, `global` for FundStats) are incremented from many
  handlers. In Postgres these become single rows under contention; the
  Rust indexer should write them inside the same transaction as the
  triggering event or use atomic counters per-batch.
- `Partner.experience`, `directTradingProfit`, success rates are
  recomputed on every UniFutures event. This is the main "computed
  derived field" pattern — non-trivial because it depends on cumulative
  totals that span events.
- `TRUSTContract.totalValueLocked` is bumped from
  `updateTotalValueLocked(tvlChange, ts)` (in `fetch/metadata.ts`) but
  the survey of mapping files shows this is not yet called from any
  handler — TVL aggregation is wired structurally but **not yet emitting
  values**. Confirm desired source-of-truth before re-implementing.
- `participantCount` on `CommitmentSale` / `BondingCurve` / `Exit` is
  maintained by checking if a participant row already exists at every
  event. Same pattern needed in Rust (likely an upsert with `INSERT ...
  ON CONFLICT DO NOTHING RETURNING xmax = 0`).

**Contract-call upserts.** Almost every fetch helper does
`ContractTemplate.bind(addr).try_<view>()` to populate fields the event
itself doesn't carry (e.g. full `getFunding(fundingId)` struct, full
`getCommitmentSale(saleId)` struct). The Rust indexer needs an RPC layer
with at-block reads; the subgraph already pays this cost on every event.

**The Foundation/`Foundation_SetFoundationConfig` handler will fail to
build** if the template is referenced in the manifest — confirm the
manifest doesn't reference it (it doesn't, in the version surveyed).
Drop the orphan files when porting.

**`Account` is a fan-in monster.** It has 25+ derived fields and 10+
typed `as<X>Contract` slots. In Postgres this becomes either (a) an
`accounts` table with N nullable FK columns, or (b) a typed adjacency
table per relation. Either is fine; pick one consciously rather than
mirroring the GraphQL shape literally.

**`Event` interface implementors share an `(emitter, transaction,
timestamp)` triple.** In Postgres this collapses naturally to an
`events` parent table with subtype columns, or to one table per
implementor. Either survives the rewrite; the GraphQL union behavior
needs to be re-exposed in async-graphql either way.

---

## 6. Indexer spec implications (honest read)

**Data model size.** ~75 entity types across 18 partial schemas; ~135
contract event signatures across 17 contract families; ~140 handler
functions across 13 mapping files. Big but tractable — the bulk is
straight upsert-on-event with a handful of side-tables.

**The straightforward 80%.** Most handlers are a deterministic event
→ upsert one or two rows → bump a counter. A code-generated Rust
handler skeleton driven from the ABI JSONs (already in
`aeqi-graph/abis/`) plus a hand-written `apply_<event>` function per
event type covers it. Postgres tables map 1:1 to entities; foreign keys
match the `@derivedFrom` links; the `Event` GraphQL interface becomes a
pg view or a typed-union resolver in async-graphql.

**The non-trivial 20%.**

1. **Module dispatch.** `TRUST_ModuleAdded` / `ModuleDeployedWithConfig`
   spawns a new event source dynamically. The Rust indexer needs an
   in-memory registry of "which addresses to watch" updated at indexing
   time, not at config time, and persisted across restarts. This is
   roughly what `graph-node` calls dynamic data sources; it's the single
   biggest piece of subgraph machinery to replicate.

2. **At-block contract reads.** Many handlers backfill struct fields by
   calling view methods on the contract. The Rust indexer needs an RPC
   client that supports historical `eth_call` at the event's block
   number, with caching (the same struct often gets re-read across many
   events).

3. **Bidirectional links with order-dependence.** Funding ↔
   Exit/CommitmentSale/BondingCurve is the canonical example. Either
   write in two phases (a "deferred link" outbox table), or accept that
   one side may be `NULL` until the second event arrives and fix it
   then.

4. **Partner / Stats aggregation.** Cumulative metrics (`experience`,
   `directTradingProfit`, `exitSuccessRate`,
   `totalValueLocked`) are pure functions of historical events, so they
   should ideally be incremental projections. In Postgres, this is
   either `UPDATE ... SET v = v + delta` inside the event txn, or a
   continuous aggregate with periodic refresh. The latter is cleaner but
   means realtime queries see stale stats — call this out.

5. **Composite / typed IDs.** The current mix of separators (`@`, `-`,
   `/`, prefixed) is ugly but referenced everywhere in handler code.
   The Rust port can either preserve the strings verbatim (safer for any
   downstream tooling that already consumes the subgraph) or move to
   typed compound primary keys (cleaner, but breaks every existing
   GraphQL query). Decide before any handler is written.

6. **`Account`'s typed slots.** The "this address might be a Token, a
   Governance, a Fund, a …" pattern on Account is essentially a
   discriminated union flattened to nullable columns. In Rust+Postgres
   it's worth normalizing this into one `account_kind` table per
   contract type (already implicit in the `<X>Contract` entities) and
   dropping the redundant slots on `Account`. The GraphQL surface can
   keep the `as<X>` resolvers as joins.

7. **Singletons.** `Metadata`, `ModuleStats`, `BeaconStats`, `FundStats`,
   `UnifuturesStats`, `UniswapPositionManagerStats`,
   `UnifuturesPositionManagerStats` — seven hot rows everyone updates.
   In Rust this is either (a) a `stats` table with `WITH ROWS LOCKED`
   per write, (b) precomputed via materialized views, or (c) replaced by
   ad-hoc `COUNT(*)`/`SUM(...)` queries at GraphQL resolve time. The
   subgraph chose (a) because graph-node serializes; Postgres can afford
   (c) for many of these.

8. **Reorg handling.** TheGraph handles chain reorgs natively
   (re-running handlers). The Rust indexer needs an explicit reorg
   strategy: track block hashes per indexed event, on reorg revert all
   writes from the affected blocks. Append-only `@entity(immutable:
   true)` rows make this easier (just delete by `block_number`); mutable
   rows need an undo log or per-row `block_number` snapshot.

9. **Handler-function-not-wired drift.** Four Budget handlers and one
   Vesting reset event have stale code paths (handler exists, manifest
   doesn't wire them). The Rust indexer should index the full event
   surface — drop the manifest as the source of truth and treat the ABI
   + emitting contract list as canonical.

10. **`Event` interface as discriminated union.** Eight types implement
    the GraphQL `Event` interface. async-graphql supports this via
    `#[derive(Interface)]` on an enum; Postgres-side it's usually
    cleaner as one row per concrete type plus a view that unions them.
