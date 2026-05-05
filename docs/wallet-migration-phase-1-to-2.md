# Wallet migration: Phase 1 → Phase 2

**Status:** Tool shipped 2026-05-05. Phase 2 smart accounts not yet live on mainnet.
**Scope:** Add a P-256 (passkey) signer to an existing custodial-EOA Entity.
**Binary:** `migrate-to-passkey` (built from `crates/aeqi-paymaster`)

---

## What this migration does

Phase 1: custodial EOA signer. aeqi holds the private key on behalf of the user.
Phase 2: passkey signer added. The user's device Secure Enclave holds the key.

This tool **adds** a P-256 signer to the Entity contract. It does **not** remove
the EOA signer. After the migration completes, the Entity has two signers. The
EOA signer is removed from the application layer at a later controlled time, after
the user has verified passkey login works.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| `AEQI_ENTITY_ADDR` | Contract address of the Entity being migrated |
| `EOA_PRIVATE_KEY` | Current custodial signer hex key (32 bytes, no `0x` prefix) |
| P-256 public key | From the user's passkey registration (WebAuthn `getPublicKey()`) |
| Bundler running | `aeqi-bundler.service` at `http://127.0.0.1:3000` |
| Entity contract has `addSigner(uint8,bytes32,bytes32)` | Phase 2 Entity contract deployed |

The P-256 public key comes from the WebAuthn credential created at passkey
enrollment. Extract it from the `AuthenticatorAttestationResponse`:

```ts
const pubkey = credential.response.getPublicKey(); // ArrayBuffer, 65 bytes
const hex = Buffer.from(pubkey).toString("hex");   // 04<X><Y>
```

---

## Running the migration

```bash
cargo build -p aeqi-paymaster --bin migrate-to-passkey --release

./target/release/migrate-to-passkey \
  --entity    0x<ENTITY_ADDRESS>              \
  --pubkey    04<64-bytes-hex-p256-key>       \
  --eoa-key   <hex-private-key>               \
  --bundler   http://127.0.0.1:3000           \
  --entry-point 0x0000000071727De22E5E9d8BAf0edAc6f37da032 \
  --chain-id  8453
```

### Dry run first (always)

```bash
./target/release/migrate-to-passkey \
  --entity  0x<ENTITY_ADDRESS> \
  --pubkey  04<64-bytes-hex-p256-key> \
  --eoa-key <hex-private-key> \
  --dry-run
```

Dry run prints the full UserOp with encoded calldata. Inspect it before submitting.

### Accepted public key formats

| Format | Length | Example |
|---|---|---|
| Uncompressed (preferred) | 65 bytes | `04` + 32-byte X + 32-byte Y |
| Raw X\|\|Y | 64 bytes | 32-byte X + 32-byte Y |

Compressed keys (33 bytes, `02`/`03` prefix) are rejected.

### Output on success

```
user_op_hash: 0x<32-byte-hex>
tx_hash:      0x<32-byte-hex>
Migration complete. Entity 0x<address> now has a P-256 signer.
```

---

## What happens inside

1. ABI-encodes `addSigner(uint8 kind=1, bytes32 pubkeyX, bytes32 pubkeyY)`.
2. Constructs a UserOp with the Entity address as `sender`.
3. Signs the UserOp with the custodial EOA key.
4. Submits via `eth_sendUserOperation` to the bundler.
5. Polls `eth_getUserOperationReceipt` every 2 s, up to 60 s.
6. Returns the UserOp hash and transaction hash.

---

## Verifying the migration

After the tool reports success, verify on-chain:

```bash
# Cast call to check signer count (Phase 2 entity must expose getSignerCount())
cast call <ENTITY_ADDR> "getSignerCount()(uint256)" --rpc-url <RPC>

# Expected: 2 (EOA signer + new passkey signer)
```

You can also inspect the `SignerAdded` event in the transaction:

```bash
cast receipt <TX_HASH> --rpc-url <RPC> | grep SignerAdded
```

---

## Caveats

**Nonce collision.** The tool uses nonce `0x0` by default. If the Entity already
has processed UserOps, the bundler will reject with AA25 (invalid nonce). Check
the current nonce first:

```bash
cast call <ENTRYPOINT_ADDR> "getNonce(address,uint192)(uint256)" \
  <ENTITY_ADDR> 0 --rpc-url <RPC>
```

The tool does not yet auto-query the nonce. If nonce mismatch occurs, the
operator must manually retry (the bundler rejects, nothing is committed on-chain).

**EOA key security.** The `--eoa-key` flag accepts the raw hex private key.
Pass it via an environment variable or secrets manager in production — do not
inline it in shell history:

```bash
migrate-to-passkey --eoa-key "$(vault kv get -field=key secret/aeqi/entity-signer)"
```

**Gas sponsorship.** The tool does not request paymaster sponsorship in Phase 1.
The Entity must have ETH for gas, or the bundler must have a policy that covers it.
Paymaster integration is the next step after Phase 2 contract deployment.

**Recovery facilitator.** aeqi holds the `recoveryFacilitator` role with a 7-day
timelock. This migration does NOT use the recovery path — it goes through the
existing EOA signer directly. The recovery path is for lost-device scenarios only.

---

## Rollback

There is no automatic rollback. Adding a signer is additive and idempotent on the
contract side. If the passkey migration was a mistake:

1. Call `removeSigner(kind=1, pubkeyX, pubkeyY)` on the Entity directly from the
   EOA signer. The Entity contract enforces that at least one signer always remains.
2. Confirm signer count returns to 1.

---

## Running the integration test

```bash
# Tier 1 (always, no deps):
cargo test -p aeqi-paymaster --test it_migrate_to_passkey

# Tier 2 (live stack required):
export ANVIL_URL=http://127.0.0.1:8545
export BUNDLER_URL=http://127.0.0.1:3000
export ENTITY_ADDR=0x<mock-entity-address>
export EOA_KEY=<hex-private-key>
cargo test -p aeqi-paymaster --test it_migrate_to_passkey -- --nocapture
```

Tier 1 tests run in CI without any external services. Tier 2 tests are skipped
automatically when `ANVIL_URL` is not set.
