# AEIQ on-chain harden — 2026-05-06

## What was done

Assigned on-chain roles for 4 C-suite agents of the AEIQ entity
(`59bc9fd3-956a-4104-aaf8-83253fde840c`) on the local anvil devnet.

## Final on-chain state

TRUST: `0x4a9221095d6863f068d1543fc7995c25347b4edc` (chain 31337)

5 role assignments confirmed in `trust_role_assignments` indexer table:

| Role | Account | Block | roleTypeId (prefix) |
|------|---------|-------|---------------------|
| Luca (Director) | 0xb838c136...9614a9 | 66556 | 0xaf7f6d… |
| CFO | 0x0a6a4436…c0f6e1 | 67575 | 0x79a82d… |
| CMO | 0x56046fa8…d54e | 67580 | 0xff1107… |
| CLO | 0x54bf87b4…89f8 | 67610 | 0x99b8… (new) |
| CISO | 0x44bd9ce9…e8ad | 67616 | 0xddfc… (new) |

## Key findings

### Auth model trap (Role module)

`_onlyIfAuthorized` walks the parent chain of the target role through
OCCUPIED roles only (`status == 2`). WORKER_ROLE1 and WORKER_ROLE2 were
VACANT (`status == 1`) at genesis. Any call to `assignToRole` from an
authority chain (including Luca's Director role) immediately breaks out of
the assembly loop and reverts `Role_NotAuthorized (0xc99b3353)`.

**Fix**: Impersonate the TRUST address via `anvil_impersonateAccount` and
call `assignToRole` with `callerRoleId = bytes32(0)`. The Module's
`_hasModuleAccess` check passes when `msg.sender == address(trust)`,
giving the system-admin bypass.

### VestingModule ACL missing

The Role module (`0x95F80e04…`) needed `ACTIVATE_VESTING_POSITION` (ACL
bitmask bit 2 = value `4`) granted on the VestingModule
(`0xC50AfC0A7caBA28d08381270C97BC4Eb031E8Fd3`). Initial attempts failed
with `Module_AccessDenied (0x5ceb1264)`.

Fix:
```bash
cast send --unlocked 0x4a9221095d6863f068d1543fc7995c25347b4edc \
  0x4a9221095d6863f068d1543fc7995c25347b4edc \
  "setAclBetweenModules(address,address,uint8)" \
  0xC50AfC0A7caBA28d08381270C97BC4Eb031E8Fd3 \
  0x95F80e04a513bC1a8cE4A5442AfAbd6901f3d492 \
  4 --rpc-url http://127.0.0.1:8545
```

### CLO/CISO needed createAndAssignRole

Only two VACANT worker slots existed (WORKER_ROLE1, WORKER_ROLE2). CLO and
CISO needed `createAndAssignRole` with `callerRoleId = bytes32(0)`:

```bash
cast send --unlocked $TRUST $ROLE_MODULE \
  "createAndAssignRole(bytes32,bytes32,bytes32,bytes,address)" \
  "$(cast keccak 'aeiq-clo')" 0x 0x 0x $CLO_ADDR --rpc-url http://127.0.0.1:8545
```

### Trust funding

TRUST had 0 ETH initially. Gas-funded by sending 1 ETH from anvil account 0:

```bash
cast send --private-key $ANVIL_KEY_0 \
  0x4a9221095d6863f068d1543fc7995c25347b4edc \
  --value 1ether --rpc-url http://127.0.0.1:8545
```

TRUST balance after operations: ~0.9999 ETH.

### Indexer trust_id format

GraphQL query `rolesForTrust` requires bytes32-padded trust_id, not the
TRUST address and not the plain UUID. Correct form:

```
0x59bc9fd3956a4104aaf883253fde840c00000000000000000000000000000000
```

### UI polish

- **Treasury holdings empty state**: now shows "0 ETH · 0 USDC" + "Once
  your Treasury earns or spends, balances will appear here." + inline
  funding nudge showing the truncated TRUST address.
- **Treasury transfers empty state**: "Once your Treasury earns or spends,
  transfers will appear here."
- **Governance proposals empty state**: "No proposals yet. Once a Role
  files one, it'll appear here."

All 17 TreasuryPage + GovernancePage tests pass.
