//! Integration test: Phase-1 → Phase-2 wallet migration (passkey signer add).
//!
//! ## Test strategy
//!
//! A live bundler and deployed AEQI Entity contract are prerequisites for a full
//! end-to-end test.  In CI (and in offline dev environments) neither is guaranteed.
//! The test therefore has two tiers:
//!
//! ### Tier 1 — always runs (no external deps)
//!
//! Validates the full migration *pipeline* using `dry_run = true`:
//! - Builds the `addSigner(P256, X, Y)` calldata correctly.
//! - Constructs a well-formed UserOp (correct field structure, non-empty signature).
//! - Returns a deterministic UserOp hash.
//! - Verifies the ABI layout: selector + signer-kind byte + pubkey X + pubkey Y.
//!
//! ### Tier 2 — runs when `ANVIL_URL` env var is set
//!
//! Deploys a mock Entity contract on a running anvil, submits the migration UserOp
//! through a live bundler, and asserts `signerCount == 2`.
//!
//! Start the full AA stack first:
//! ```text
//! anvil &
//! # deploy mock Entity, set ENTITY_ADDR and EOA_KEY
//! export ANVIL_URL=http://127.0.0.1:8545
//! export BUNDLER_URL=http://127.0.0.1:3000
//! export ENTITY_ADDR=0x<deployed-mock-entity>
//! export EOA_KEY=<hex-private-key>
//! cargo test -p aeqi-paymaster --test it_migrate_to_passkey -- --nocapture
//! ```

use aeqi_paymaster::migrate::{
    MigrationParams, SIGNER_KIND_P256, add_signer_selector, encode_add_p256_signer,
    parse_p256_pubkey, run_migration,
};
use alloy::primitives::{Address, B256};

// ── Tier 1: ABI encoding assertions (always run) ─────────────────────────────

/// Verify the selector matches `keccak256("addSigner(uint8,bytes32,bytes32)")[0..4]`.
#[test]
fn test_add_signer_selector_is_correct() {
    use alloy::primitives::keccak256;
    let expected = {
        let h = keccak256(b"addSigner(uint8,bytes32,bytes32)");
        [h[0], h[1], h[2], h[3]]
    };
    assert_eq!(add_signer_selector(), expected);
}

/// Calldata layout: selector(4) + kind(32) + X(32) + Y(32) = 100 bytes.
#[test]
fn test_encode_add_p256_signer_total_length() {
    let x = B256::from([0xAAu8; 32]);
    let y = B256::from([0xBBu8; 32]);
    let calldata = encode_add_p256_signer(x, y);
    assert_eq!(
        calldata.len(),
        100,
        "calldata must be 100 bytes: 4 + 32 + 32 + 32"
    );
}

/// The signer-kind discriminant must be `P256 = 1` at byte offset 35 (last byte of the
/// first 32-byte ABI word, which is the uint8 padded to 256 bits).
#[test]
fn test_encode_add_p256_signer_kind_discriminant() {
    let x = B256::from([0u8; 32]);
    let y = B256::from([0u8; 32]);
    let calldata = encode_add_p256_signer(x, y);
    // Bytes 0..4: selector. Bytes 4..36: kind word. Byte 35 is the LSB of the word.
    assert_eq!(
        calldata[35], SIGNER_KIND_P256,
        "kind discriminant must be P256=1"
    );
    // All preceding kind bytes must be zero padding.
    for b in &calldata[4..35] {
        assert_eq!(*b, 0, "kind word padding must be zero");
    }
}

/// The X coordinate occupies bytes 36..68, Y occupies 68..100.
#[test]
fn test_encode_add_p256_signer_coordinates_placement() {
    let x = B256::from([0x11u8; 32]);
    let y = B256::from([0x22u8; 32]);
    let calldata = encode_add_p256_signer(x, y);
    assert_eq!(&calldata[36..68], x.as_slice(), "X coordinate mismatch");
    assert_eq!(&calldata[68..100], y.as_slice(), "Y coordinate mismatch");
}

// ── P-256 pubkey parsing ─────────────────────────────────────────────────────

#[test]
fn test_parse_p256_pubkey_uncompressed_format() {
    let mut raw = vec![0x04u8];
    raw.extend([0x01u8; 32]); // X
    raw.extend([0x02u8; 32]); // Y
    let (x, y) = parse_p256_pubkey(&hex::encode(&raw)).unwrap();
    assert_eq!(x, B256::from([0x01u8; 32]));
    assert_eq!(y, B256::from([0x02u8; 32]));
}

#[test]
fn test_parse_p256_pubkey_raw_format() {
    let mut raw = vec![0xCCu8; 32]; // X
    raw.extend([0xDDu8; 32]); // Y
    let (x, y) = parse_p256_pubkey(&hex::encode(&raw)).unwrap();
    assert_eq!(x, B256::from([0xCCu8; 32]));
    assert_eq!(y, B256::from([0xDDu8; 32]));
}

#[test]
fn test_parse_p256_pubkey_rejects_wrong_length() {
    assert!(
        parse_p256_pubkey("deadbeef").is_err(),
        "must reject 2-byte input"
    );
    // 33-byte compressed key (not supported)
    let compressed = format!("02{}", "aa".repeat(32));
    assert!(
        parse_p256_pubkey(&compressed).is_err(),
        "must reject 33-byte compressed key"
    );
}

#[test]
fn test_parse_p256_pubkey_with_0x_prefix() {
    let mut raw = vec![0x04u8];
    raw.extend([0xFFu8; 32]);
    raw.extend([0xEEu8; 32]);
    let hex_str = format!("0x{}", hex::encode(&raw));
    let (x, y) = parse_p256_pubkey(&hex_str).unwrap();
    assert_eq!(x, B256::from([0xFFu8; 32]));
    assert_eq!(y, B256::from([0xEEu8; 32]));
}

// ── Tier 1: dry-run migration pipeline ───────────────────────────────────────

/// Run a full migration with `dry_run = true`.
///
/// Verifies:
/// - `run_migration` completes without error.
/// - Returns a non-empty UserOp hash (32-byte hex, 0x-prefixed).
/// - `tx_hash` is `None` (no bundler submission in dry-run).
#[tokio::test]
async fn test_dry_run_migration_returns_user_op_hash() {
    // Known anvil test key (Hardhat/Foundry default account 0).
    let eoa_key = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

    // Fake P-256 pubkey: all 0x11 bytes (X) + all 0x22 bytes (Y).
    let pubkey_x = B256::from([0x11u8; 32]);
    let pubkey_y = B256::from([0x22u8; 32]);

    let params = MigrationParams {
        entity_address: Address::from([0xABu8; 20]),
        pubkey_x,
        pubkey_y,
        bundler_url: "http://127.0.0.1:3000".to_string(),
        entry_point: Address::from([0x00u8; 20]),
        chain_id: 31337,
        eoa_private_key: eoa_key.to_string(),
        dry_run: true,
    };

    let receipt = run_migration(&params)
        .await
        .expect("dry-run migration must not fail");

    // UserOp hash must be a 0x-prefixed 32-byte hex string.
    assert!(
        receipt.user_op_hash.starts_with("0x"),
        "user_op_hash must start with 0x, got: {}",
        receipt.user_op_hash,
    );
    let hash_hex = receipt.user_op_hash.trim_start_matches("0x");
    assert_eq!(
        hash_hex.len(),
        64,
        "user_op_hash must be 32 bytes (64 hex chars), got: {hash_hex}",
    );

    // No tx_hash in dry-run.
    assert!(
        receipt.tx_hash.is_none(),
        "dry-run must not return a tx_hash",
    );
}

/// Two migrations for different Entities must produce different UserOp hashes.
#[tokio::test]
async fn test_dry_run_different_entities_produce_different_hashes() {
    let eoa_key = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    let pubkey_x = B256::from([0x11u8; 32]);
    let pubkey_y = B256::from([0x22u8; 32]);

    let make_params = |entity_byte: u8| MigrationParams {
        entity_address: Address::from([entity_byte; 20]),
        pubkey_x,
        pubkey_y,
        bundler_url: "http://127.0.0.1:3000".to_string(),
        entry_point: Address::from([0x00u8; 20]),
        chain_id: 31337,
        eoa_private_key: eoa_key.to_string(),
        dry_run: true,
    };

    let r1 = run_migration(&make_params(0xAB)).await.unwrap();
    let r2 = run_migration(&make_params(0xCD)).await.unwrap();

    assert_ne!(
        r1.user_op_hash, r2.user_op_hash,
        "different entity addresses must produce different UserOp hashes",
    );
}

// ── Tier 2: live bundler test (skipped unless ANVIL_URL is set) ──────────────

/// Full end-to-end migration test against a running anvil + bundler.
///
/// Prerequisites:
///   - anvil at ANVIL_URL (default http://127.0.0.1:8545)
///   - rundler bundler at BUNDLER_URL (default http://127.0.0.1:3000)
///   - MockEntity deployed, address in ENTITY_ADDR
///   - EOA private key (current signer) in EOA_KEY
///
/// The test deploys a MockEntity (Solidity below) with EOA as the sole signer,
/// runs the migration tool, and then calls `getSignerCount()` via eth_call to
/// assert it returned 2 (EOA + passkey).
///
/// MockEntity.sol (reference — deployed separately via foundry scripts):
/// ```solidity
/// contract MockEntity {
///     uint8[] private signerKinds;
///     bytes32[] private signerX;
///     bytes32[] private signerY;
///
///     constructor(address eoa) {
///         signerKinds.push(0); // EOA kind
///         signerX.push(bytes32(uint256(uint160(eoa))));
///         signerY.push(0);
///     }
///
///     function addSigner(uint8 kind, bytes32 x, bytes32 y) external {
///         signerKinds.push(kind);
///         signerX.push(x);
///         signerY.push(y);
///         emit SignerAdded(kind, x, y);
///     }
///
///     function getSignerCount() external view returns (uint256) {
///         return signerKinds.length;
///     }
///
///     event SignerAdded(uint8 kind, bytes32 x, bytes32 y);
/// }
/// ```
#[tokio::test]
async fn test_live_migration_adds_passkey_signer() {
    // Skip if env vars are not set — this test requires a live AA stack.
    let anvil_url = match std::env::var("ANVIL_URL") {
        Ok(v) => v,
        Err(_) => {
            eprintln!("SKIP: ANVIL_URL not set — live migration test requires a running anvil");
            return;
        }
    };
    let bundler_url =
        std::env::var("BUNDLER_URL").unwrap_or_else(|_| "http://127.0.0.1:3000".to_string());
    let entity_addr_str = match std::env::var("ENTITY_ADDR") {
        Ok(v) => v,
        Err(_) => {
            eprintln!("SKIP: ENTITY_ADDR not set");
            return;
        }
    };
    let eoa_key = match std::env::var("EOA_KEY") {
        Ok(v) => v,
        Err(_) => {
            eprintln!("SKIP: EOA_KEY not set");
            return;
        }
    };

    let entity_address: Address = entity_addr_str
        .trim_start_matches("0x")
        .parse()
        .expect("ENTITY_ADDR must be a valid address");

    // Generate a deterministic fake P-256 keypair for the test.
    let pubkey_x = B256::from([0xABu8; 32]);
    let pubkey_y = B256::from([0xCDu8; 32]);

    let params = MigrationParams {
        entity_address,
        pubkey_x,
        pubkey_y,
        bundler_url: bundler_url.clone(),
        entry_point: "0x0000000071727De22E5E9d8BAf0edAc6f37da032"
            .trim_start_matches("0x")
            .parse()
            .unwrap(),
        chain_id: 31337,
        eoa_private_key: eoa_key,
        dry_run: false,
    };

    let receipt = run_migration(&params)
        .await
        .expect("live migration must succeed");

    assert!(
        receipt.user_op_hash.starts_with("0x"),
        "user_op_hash must be 0x-prefixed"
    );
    assert!(
        receipt.tx_hash.is_some(),
        "live migration must return a tx_hash"
    );

    // Call getSignerCount() on the mock entity via eth_call.
    // Selector: keccak256("getSignerCount()")[0..4]
    let get_signer_count_selector = {
        use alloy::primitives::keccak256;
        let h = keccak256(b"getSignerCount()");
        format!("0x{}", hex::encode(&h[0..4]))
    };

    let client = reqwest::Client::new();
    let resp = client
        .post(&anvil_url)
        .json(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "eth_call",
            "params": [
                {
                    "to": entity_addr_str,
                    "data": get_signer_count_selector,
                },
                "latest"
            ],
        }))
        .send()
        .await
        .expect("eth_call request failed")
        .json::<serde_json::Value>()
        .await
        .expect("eth_call response parse failed");

    let result_hex = resp["result"]
        .as_str()
        .expect("eth_call must return a result");
    // ABI-decode uint256: 32 bytes, last byte is the value.
    let count_bytes = hex::decode(result_hex.trim_start_matches("0x")).expect("result must be hex");
    assert_eq!(count_bytes.len(), 32, "uint256 is 32 bytes");
    let count = count_bytes[31]; // LSB = value (fits in u8 for test purposes)

    assert_eq!(
        count, 2,
        "after migration, Entity must have 2 signers (EOA + passkey), got {count}"
    );
}
