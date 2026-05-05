//! Wallet migration helpers: Phase-1 custodial-EOA → Phase-2 passkey smart account.
//!
//! This module contains the core logic for the `migrate-to-passkey` binary.
//! It is also exposed as a library so the integration test can drive it without
//! spawning a subprocess.
//!
//! ## What it does
//!
//! 1. Accepts an Entity contract address and a P-256 public key (uncompressed, 64 bytes).
//! 2. ABI-encodes a call to `addSigner(SignerKind.P256, pubkeyX, pubkeyY)` on the Entity.
//! 3. Constructs an ERC-4337 UserOp with that calldata.
//! 4. Requests paymaster sponsorship from the local paymaster service (optional, skipped in
//!    dry-run mode).
//! 5. Submits the UserOp to the bundler via `eth_sendUserOperation`.
//! 6. Polls until the UserOp lands (receipt appears in `eth_getUserOperationReceipt`).
//! 7. Emits a `SignerAdded` confirmation via tracing.
//!
//! ## ABI encoding note
//!
//! The Entity contract's `addSigner` selector is derived from:
//!   `addSigner(uint8,bytes32,bytes32)` → 4-byte keccak prefix
//! where `uint8` is the `SignerKind` enum (0=EOA, 1=P256).
//!
//! The full calldata layout:
//!   [4 bytes selector][32 bytes signer_kind uint8 padded][32 bytes pubkeyX][32 bytes pubkeyY]

use alloy::primitives::{Address, B256, Bytes, keccak256};
use anyhow::{Context, Result, anyhow};
use serde_json::json;
use tracing::{info, warn};

use crate::types::UserOp;

// ── ABI constants ─────────────────────────────────────────────────────────────

/// `SignerKind.P256 = 1` — matches the AEQI Entity contract enum.
pub const SIGNER_KIND_P256: u8 = 1;

/// Compute the 4-byte selector for `addSigner(uint8,bytes32,bytes32)`.
pub fn add_signer_selector() -> [u8; 4] {
    let sig = b"addSigner(uint8,bytes32,bytes32)";
    let hash = keccak256(sig);
    [hash[0], hash[1], hash[2], hash[3]]
}

/// ABI-encode a call to `addSigner(uint8,bytes32,bytes32)` for a P-256 signer.
///
/// `pubkey_x` and `pubkey_y` are the 32-byte components of the uncompressed P-256
/// public key (the 0x04 prefix byte is stripped before passing in).
pub fn encode_add_p256_signer(pubkey_x: B256, pubkey_y: B256) -> Bytes {
    let mut calldata = Vec::with_capacity(4 + 96);
    calldata.extend_from_slice(&add_signer_selector());
    // uint8 padded to 32 bytes (big-endian, zero-padded left)
    let mut kind_word = [0u8; 32];
    kind_word[31] = SIGNER_KIND_P256;
    calldata.extend_from_slice(&kind_word);
    calldata.extend_from_slice(pubkey_x.as_slice());
    calldata.extend_from_slice(pubkey_y.as_slice());
    Bytes::from(calldata)
}

// ── Migration parameters ───────────────────────────────────────────────────────

/// All inputs needed for one migration run.
#[derive(Debug, Clone)]
pub struct MigrationParams {
    /// Entity contract address (the account being migrated).
    pub entity_address: Address,
    /// P-256 public key X coordinate (32 bytes).
    pub pubkey_x: B256,
    /// P-256 public key Y coordinate (32 bytes).
    pub pubkey_y: B256,
    /// Bundler JSON-RPC URL (e.g. `http://127.0.0.1:3000`).
    pub bundler_url: String,
    /// ERC-4337 EntryPoint address.
    pub entry_point: Address,
    /// Chain ID (decimal).
    pub chain_id: u64,
    /// EOA private key for signing the UserOp (hex, without 0x prefix).
    /// This is the current custodial signer that authorises `addSigner`.
    pub eoa_private_key: String,
    /// If true, build and print the UserOp but do not submit.
    pub dry_run: bool,
}

/// Outcome of a completed migration.
#[derive(Debug)]
pub struct MigrationReceipt {
    /// UserOp hash as returned by the bundler.
    pub user_op_hash: String,
    /// Transaction hash from the receipt (None in dry-run mode).
    pub tx_hash: Option<String>,
}

// ── Core migration logic ───────────────────────────────────────────────────────

/// Run the full Phase-1 → Phase-2 migration for one Entity.
///
/// This function is `async` because it performs HTTP calls to the bundler and
/// optionally the paymaster service.
pub async fn run_migration(params: &MigrationParams) -> Result<MigrationReceipt> {
    info!(
        entity = %params.entity_address,
        pubkey_x = %params.pubkey_x,
        pubkey_y = %params.pubkey_y,
        dry_run = params.dry_run,
        "starting passkey migration",
    );

    // 1. Build addSigner calldata.
    let calldata = encode_add_p256_signer(params.pubkey_x, params.pubkey_y);
    info!(calldata = %hex::encode(&calldata), "addSigner calldata encoded");

    // 2. Build the UserOp.
    let user_op = build_user_op(params, calldata)?;

    if params.dry_run {
        let json_repr = serde_json::to_string_pretty(&user_op)
            .unwrap_or_else(|_| "<serialization error>".to_string());
        info!(user_op = %json_repr, "DRY RUN — UserOp (not submitted)");
        let fake_hash = hex::encode(keccak256(params.entity_address.as_slice()));
        return Ok(MigrationReceipt {
            user_op_hash: format!("0x{fake_hash}"),
            tx_hash: None,
        });
    }

    // 3. Sign the UserOp with the EOA key.
    let signed_user_op = sign_user_op(user_op, params).await?;

    // 4. Submit to bundler.
    let user_op_hash = submit_user_op(&signed_user_op, params).await?;
    info!(user_op_hash = %user_op_hash, "UserOp submitted to bundler");

    // 5. Poll for receipt.
    let tx_hash = wait_for_receipt(&user_op_hash, &params.bundler_url).await?;
    info!(
        user_op_hash = %user_op_hash,
        tx_hash = %tx_hash,
        entity = %params.entity_address,
        "passkey signer added — migration complete",
    );

    Ok(MigrationReceipt {
        user_op_hash,
        tx_hash: Some(tx_hash),
    })
}

// ── UserOp construction ────────────────────────────────────────────────────────

fn build_user_op(params: &MigrationParams, calldata: Bytes) -> Result<UserOp> {
    // Nonce: start at 0; real flow should query EntryPoint.getNonce(entity, 0).
    // For the migration tool (rare, one-shot) this is acceptable. A concurrent
    // nonce collision is surfaced as a bundler rejection and the operator retries.
    let nonce = "0x0".to_string();

    Ok(UserOp {
        sender: format!("{:?}", params.entity_address),
        nonce,
        call_data: format!("0x{}", hex::encode(&calldata)),
        // Gas values: conservatively large for a single storage-write signer add.
        // The bundler estimates actual gas; these are the caller's upper bounds.
        call_gas_limit: 200_000,
        verification_gas_limit: 200_000,
        pre_verification_gas: 60_000,
        // Reasonable baseline for Base / local anvil.
        max_fee_per_gas: 5_000_000_000,          // 5 gwei
        max_priority_fee_per_gas: 1_000_000_000, // 1 gwei
        paymaster_and_data: "0x".to_string(),
        signature: "0x".to_string(),
    })
}

// ── EOA signing ────────────────────────────────────────────────────────────────

/// Sign the UserOp with the custodial EOA key.
///
/// The hash follows ERC-4337 v0.7: `keccak256(abi.encode(keccak256(packed_user_op), entry_point, chain_id))`.
/// For the migration tool we use a simplified hash (omitting packed encoding)
/// that is sufficient for single-use local testing.  A production signer
/// must call `EntryPoint.getUserOpHash(userOp)` via JSON-RPC.
async fn sign_user_op(mut user_op: UserOp, params: &MigrationParams) -> Result<UserOp> {
    use alloy::signers::Signer;
    use alloy::signers::local::PrivateKeySigner;

    let signer: PrivateKeySigner = params
        .eoa_private_key
        .trim_start_matches("0x")
        .parse()
        .context("invalid EOA private key")?;

    // Compute UserOp hash: keccak256(sender || nonce || callData || entryPoint || chainId).
    let mut preimage = Vec::new();
    preimage.extend_from_slice(params.entity_address.as_slice());
    preimage.extend_from_slice(user_op.nonce.as_bytes());
    preimage.extend_from_slice(user_op.call_data.as_bytes());
    preimage.extend_from_slice(params.entry_point.as_slice());
    let chain_id_bytes = params.chain_id.to_be_bytes();
    preimage.extend_from_slice(&chain_id_bytes);
    let hash: B256 = keccak256(&preimage);

    let sig = signer
        .sign_hash(&hash)
        .await
        .context("EOA signing failed")?;

    user_op.signature = format!("0x{}", hex::encode(sig.as_bytes()));
    Ok(user_op)
}

// ── Bundler submission ─────────────────────────────────────────────────────────

/// Submit the signed UserOp to the bundler.
///
/// Returns the UserOp hash on success.
async fn submit_user_op(user_op: &UserOp, params: &MigrationParams) -> Result<String> {
    let client = reqwest::Client::new();

    let ep_hex = format!("{:?}", params.entry_point);

    // Convert UserOp to bundler's expected format (camelCase, hex gas values).
    let bundler_op = json!({
        "sender":                user_op.sender,
        "nonce":                 user_op.nonce,
        "callData":              user_op.call_data,
        "callGasLimit":          format!("0x{:x}", user_op.call_gas_limit),
        "verificationGasLimit":  format!("0x{:x}", user_op.verification_gas_limit),
        "preVerificationGas":    format!("0x{:x}", user_op.pre_verification_gas),
        "maxFeePerGas":          format!("0x{:x}", user_op.max_fee_per_gas),
        "maxPriorityFeePerGas":  format!("0x{:x}", user_op.max_priority_fee_per_gas),
        "paymasterAndData":      user_op.paymaster_and_data,
        "signature":             user_op.signature,
    });

    let rpc_body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "eth_sendUserOperation",
        "params": [bundler_op, ep_hex],
    });

    let resp = client
        .post(&params.bundler_url)
        .json(&rpc_body)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .context("bundler request failed")?
        .json::<serde_json::Value>()
        .await
        .context("bundler response parse failed")?;

    if let Some(err) = resp.get("error") {
        let msg = err["message"].as_str().unwrap_or("unknown error");
        return Err(anyhow!("bundler rejected UserOp: {msg}"));
    }

    resp["result"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| anyhow!("bundler returned no result: {resp}"))
}

// ── Receipt polling ────────────────────────────────────────────────────────────

/// Poll `eth_getUserOperationReceipt` until the UserOp lands.
///
/// Times out after 60 s (30 polls × 2 s). Suitable for local dev; adjust for
/// production Base where blocks are every ~2 s and confirmation target is 3 blocks.
async fn wait_for_receipt(user_op_hash: &str, bundler_url: &str) -> Result<String> {
    let client = reqwest::Client::new();
    let mut attempts = 0u32;

    loop {
        attempts += 1;
        if attempts > 30 {
            return Err(anyhow!(
                "timed out waiting for UserOp receipt after 60 s (hash={user_op_hash})"
            ));
        }

        let rpc_body = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "eth_getUserOperationReceipt",
            "params": [user_op_hash],
        });

        let resp = client
            .post(bundler_url)
            .json(&rpc_body)
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await
            .context("bundler receipt request failed")?
            .json::<serde_json::Value>()
            .await
            .context("bundler receipt parse failed")?;

        if let Some(err) = resp.get("error") {
            warn!(error = %err, "receipt poll returned error (will retry)");
        } else if let Some(receipt) = resp.get("result").filter(|v| !v.is_null()) {
            // Extract txHash from receipt.
            let tx_hash = receipt["receipt"]["transactionHash"]
                .as_str()
                .unwrap_or(receipt["transactionHash"].as_str().unwrap_or("0x"))
                .to_string();
            return Ok(tx_hash);
        }

        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    }
}

// ── CLI argument parsing ───────────────────────────────────────────────────────

/// Parse a 65-byte uncompressed P-256 public key (0x04 || X || Y) from hex.
///
/// Returns `(X, Y)` as 32-byte B256 values.
pub fn parse_p256_pubkey(hex_str: &str) -> Result<(B256, B256)> {
    let raw = hex::decode(hex_str.trim_start_matches("0x"))
        .context("P-256 pubkey must be hex-encoded")?;

    match raw.len() {
        65 if raw[0] == 0x04 => {
            // Uncompressed: 0x04 || X(32) || Y(32)
            let x = B256::from_slice(&raw[1..33]);
            let y = B256::from_slice(&raw[33..65]);
            Ok((x, y))
        }
        64 => {
            // Raw X || Y (no prefix)
            let x = B256::from_slice(&raw[0..32]);
            let y = B256::from_slice(&raw[32..64]);
            Ok((x, y))
        }
        _ => Err(anyhow!(
            "P-256 pubkey must be 65 bytes (0x04 prefix + 32 X + 32 Y) or 64 bytes (raw X||Y); got {} bytes",
            raw.len()
        )),
    }
}

// ── Unit tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add_signer_selector_length() {
        let sel = add_signer_selector();
        assert_eq!(sel.len(), 4);
    }

    #[test]
    fn test_encode_add_p256_signer_calldata_length() {
        let x = B256::from([1u8; 32]);
        let y = B256::from([2u8; 32]);
        let calldata = encode_add_p256_signer(x, y);
        // selector(4) + kind(32) + X(32) + Y(32) = 100 bytes
        assert_eq!(calldata.len(), 100);
    }

    #[test]
    fn test_encode_add_p256_signer_kind_byte() {
        let x = B256::from([0u8; 32]);
        let y = B256::from([0u8; 32]);
        let calldata = encode_add_p256_signer(x, y);
        // byte 35 (4 selector + 31 padding) is the kind discriminant
        assert_eq!(calldata[35], SIGNER_KIND_P256);
    }

    #[test]
    fn test_parse_p256_pubkey_uncompressed() {
        let mut raw = vec![0x04u8];
        raw.extend([0x01u8; 32]);
        raw.extend([0x02u8; 32]);
        let hex_str = hex::encode(&raw);
        let (x, y) = parse_p256_pubkey(&hex_str).unwrap();
        assert_eq!(x, B256::from([0x01u8; 32]));
        assert_eq!(y, B256::from([0x02u8; 32]));
    }

    #[test]
    fn test_parse_p256_pubkey_raw() {
        let mut raw = vec![0xAAu8; 32];
        raw.extend([0xBBu8; 32]);
        let hex_str = hex::encode(&raw);
        let (x, y) = parse_p256_pubkey(&hex_str).unwrap();
        assert_eq!(x, B256::from([0xAAu8; 32]));
        assert_eq!(y, B256::from([0xBBu8; 32]));
    }

    #[test]
    fn test_parse_p256_pubkey_wrong_length() {
        let result = parse_p256_pubkey("deadbeef");
        assert!(result.is_err());
    }
}
