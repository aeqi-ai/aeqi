# ERC-4337 Paymaster Deployment

Service: `aeqi-paymaster.service` — Rust signing service for ERC-4337 gas sponsorship.
Implements the ERC-7677 `pm_sponsorUserOperation` JSON-RPC method.

## Topology

```
anvil :8545 (chain 31337)
  └── aeqi-bundler :3000 (JSON-RPC, rundler v0.11.0)
        └── EntryPoint v0.7 @ 0x0000000071727De22E5E9d8BAf0edAc6f37da032
              └── aeqi-paymaster :3001 (JSON-RPC + REST)
                    ├── Paymaster.sol (deployed on anvil, addr TBD)
                    └── /var/lib/aeqi-paymaster/paymaster.db (gas budgets)
```

The paymaster runs as the `aeqi-paymaster` system user with a dedicated hot signing
key (`PAYMASTER_SIGNER_KEY`). The key is separate from the bundler signer and from
the anvil deploy account.

## Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `POST /` | JSON-RPC 2.0 | ERC-7677 `pm_sponsorUserOperation` — bundler / wallet integration |
| `POST /paymaster/sponsor` | REST | Internal tooling / smoke tests |
| `GET /health` | REST | Liveness probe |

### `pm_sponsorUserOperation` (ERC-7677)

```json
// Request
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "pm_sponsorUserOperation",
  "params": [
    { "sender": "0x...", "nonce": "0x0", "callData": "0x", ... },
    "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
    "0x7a69"
  ]
}

// Success response
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "paymasterAndData": "0x<20-byte-addr><6-byte-validUntil><6-byte-validAfter><65-byte-sig>",
    "validUntil": 1746000000,
    "validAfter": 0,
    "signature": "0x..."
  }
}

// Denied (budget exhausted)
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": { "code": -32500, "message": "gas budget exhausted: ..." }
}
```

## Files

| Path | Purpose |
|---|---|
| `/usr/local/bin/aeqi-paymaster` | Rust binary (built from `crates/aeqi-paymaster`) |
| `/etc/aeqi-paymaster/env` | Env vars — mode 600, aeqi-paymaster owner |
| `/etc/systemd/system/aeqi-paymaster.service` | systemd unit (shipped at `deploy/aeqi-paymaster.service`) |
| `/var/lib/aeqi-paymaster/paymaster.db` | SQLite gas-budget ledger |

## Environment variables

| Var | Required | Default | Description |
|---|---|---|---|
| `PAYMASTER_PRIVATE_KEY` | yes | — | 32-byte hex secp256k1 signing key (`0x`-prefix optional) |
| `PAYMASTER_BIND` | no | `127.0.0.1:3001` | Listen address |
| `PAYMASTER_DB_PATH` | no | `/var/lib/aeqi-paymaster/paymaster.db` | SQLite ledger path |
| `PAYMASTER_VALID_FOR_SECS` | no | `900` | Signature validity window (seconds, default 15 min) |

**`PAYMASTER_PRIVATE_KEY` must never appear in source, logs, or unit files.** Deliver it
exclusively via `/etc/aeqi-paymaster/env` (mode 600, owned by `aeqi-paymaster`).

## Installation

```bash
# 1. Build binary
cargo build --release -p aeqi-paymaster
sudo cp target/release/aeqi-paymaster /usr/local/bin/aeqi-paymaster

# 2. Create system user + working directory
sudo useradd --system --no-create-home --shell /usr/sbin/nologin aeqi-paymaster
sudo mkdir -p /var/lib/aeqi-paymaster /etc/aeqi-paymaster
sudo chown aeqi-paymaster:aeqi-paymaster /var/lib/aeqi-paymaster /etc/aeqi-paymaster

# 3. Write env file (mode 600)
sudo tee /etc/aeqi-paymaster/env <<EOF
PAYMASTER_PRIVATE_KEY=<your-32-byte-hex-key>
PAYMASTER_BIND=127.0.0.1:3001
PAYMASTER_DB_PATH=/var/lib/aeqi-paymaster/paymaster.db
PAYMASTER_VALID_FOR_SECS=900
EOF
sudo chmod 600 /etc/aeqi-paymaster/env
sudo chown aeqi-paymaster:aeqi-paymaster /etc/aeqi-paymaster/env

# 4. Install systemd unit
sudo cp deploy/aeqi-paymaster.service /etc/systemd/system/
sudo systemctl daemon-reload

# 5. Start (enable after validation)
sudo systemctl start aeqi-paymaster
```

## Service management

```bash
# Start (leaves Disabled — autostart requires explicit enable)
systemctl start aeqi-paymaster

# Enable autostart after you've validated end-to-end
systemctl enable aeqi-paymaster

# Status + recent logs
systemctl status aeqi-paymaster
journalctl -u aeqi-paymaster -f

# Restart after config change
systemctl restart aeqi-paymaster
```

## Smoke test recipe

```bash
# 1. Health check
curl -s http://127.0.0.1:3001/health
# Expect: {"status":"ok"}

# 2. ERC-7677 pm_sponsorUserOperation (entity with budget)
curl -s http://127.0.0.1:3001 \
  -X POST -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0","id":1,"method":"pm_sponsorUserOperation",
    "params":[
      {
        "sender":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        "nonce":"0x0","callData":"0x",
        "callGasLimit":100000,"verificationGasLimit":150000,"preVerificationGas":21000,
        "maxFeePerGas":1000000000,"maxPriorityFeePerGas":100000000,
        "paymasterAndData":"0x","signature":"0x"
      },
      "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
      "0x7a69"
    ]
  }'
# Expect: {"jsonrpc":"2.0","id":1,"result":{"paymasterAndData":"0x...","validUntil":...}}

# 3. Run integration smoke tests (no chain required)
cargo test -p aeqi-paymaster --test api_smoke -- --nocapture
# Expect: 5 tests pass

# 4. Bundler smoke tests (requires aeqi-bundler running)
cargo test -p aeqi-paymaster --test it_bundler_smoke -- --nocapture
# Expect: 3 tests pass
```

## paymasterAndData encoding

```
paymasterAndData = address(paymaster, 20 bytes)
                 ++ uint48(validUntil, 6 bytes, big-endian)
                 ++ uint48(validAfter, 6 bytes, big-endian)
                 ++ bytes(signature, 65 bytes, r||s||v)
```

Total: 97 bytes = 194 hex chars (0x + 192).

The Paymaster.sol `validatePaymasterUserOp` function verifies the ECDSA signature
over `keccak256(abi.encodePacked(userOpHash, validUntil, validAfter))`. Phase-2
will call `EntryPoint.getUserOpHash(userOp)` via RPC to obtain the real `userOpHash`;
Phase-1 derives a deterministic stub hash from `sender ++ nonce`.

## Policy — Phase-1

Per-entity monthly gas budget stored in SQLite (`gas_budgets` table). Default: 0.1 ETH
per entity per month. Budget is seeded on first access (Phase-1 stand-in for platform
provisioning). Phase-2 will:

1. Resolve `userOp.sender` → entity ID via `http://127.0.0.1:8443/internal/entities/...`
2. Assert billing status active via platform HTTP.
3. Integrate with Stripe usage metering for accurate cost accounting.
4. Add a monthly budget-reset cron.

## Troubleshooting

**Service starts but requests hang**

Check that `aeqi-bundler.service` is running — `aeqi-paymaster` doesn't depend on it
at process start but upstream callers (bundlers) may route requests in sequence.

**`PAYMASTER_PRIVATE_KEY env var not set` at startup**

`/etc/aeqi-paymaster/env` is missing or `EnvironmentFile` path in the unit is wrong.
Verify: `sudo -u aeqi-paymaster cat /etc/aeqi-paymaster/env`.

**`attempt to write a readonly database`**

`/var/lib/aeqi-paymaster/paymaster.db` is owned by root from a previous run. Fix:
`sudo chown aeqi-paymaster:aeqi-paymaster /var/lib/aeqi-paymaster/paymaster.db`.

**Signer key rotation**

Update `PAYMASTER_PRIVATE_KEY` in `/etc/aeqi-paymaster/env` and
`systemctl restart aeqi-paymaster`. Fund the new address with ETH before restarting
if the Paymaster.sol contract requires a funded signer.
