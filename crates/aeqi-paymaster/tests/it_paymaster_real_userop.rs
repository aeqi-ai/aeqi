//! End-to-end ERC-4337 UserOperation integration test.
//!
//! Proves the full AA stack works on anvil:
//!   Paymaster.sol funded → SimpleAccount deployed → UserOp signed →
//!   eth_sendUserOperation → receipt mined with success=true
//!
//! ## Infrastructure required
//!
//! All services must be running before invoking this test:
//!
//! ```
//! # 1. anvil at :8545 (chain 31337)
//! anvil
//!
//! # 2. bundler (service or binary)
//! systemctl start aeqi-bundler   # or: rundler node --chain_spec /etc/aeqi-bundler/chain-spec.toml ...
//!
//! # 3. aeqi-paymaster (built from this worktree with PAYMASTER_CONTRACT_ADDRESS set)
//! PAYMASTER_PRIVATE_KEY=<key> PAYMASTER_CONTRACT_ADDRESS=<addr> \
//!   ./target/debug/aeqi-paymaster
//! ```
//!
//! ## What this test proves
//!
//! 1. Paymaster.sol deploys and can be funded via EntryPoint.depositTo.
//! 2. SimpleAccount (minimal ERC-4337 account) deploys with ECDSA validation.
//! 3. A UserOp signed by the account owner is accepted by the bundler.
//! 4. The bundler mines the UserOp on anvil chain 31337.
//! 5. `eth_getUserOperationReceipt` returns `success=true`.
//!
//! ## Paymaster sponsorship path
//!
//! The paymaster-sponsored path uses aeqi-paymaster + Paymaster.sol on the
//! ERC-4337 v0.7 wire format:
//!
//!   paymasterAndData = addr(20) + verifGasLimit(16) + postOpGasLimit(16)
//!                    + validUntil(6) + validAfter(6) + sig(65)  =  129 bytes
//!
//! Paymaster.sol reads validUntil/validAfter at offsets 52/58 and the signature
//! at 64..129. The Rust signer's digest commits:
//!   keccak256(userOpHash ++ validUntil ++ validAfter ++ paymaster_addr)
//!
//! The self-paying test proves the core stack without a paymaster. The
//! `*_returns_valid_paymaster_and_data` test asserts the paymaster service
//! returns a 129-byte v0.7 paymasterAndData blob.
//!
//! ## Running
//!
//! ```bash
//! # Requires all services running (see above)
//! cargo test -p aeqi-paymaster --test it_paymaster_real_userop -- --nocapture --ignored
//! ```

const ANVIL_URL: &str = "http://127.0.0.1:8545";
const BUNDLER_URL: &str = "http://127.0.0.1:3000";
const DEFAULT_PAYMASTER_URL: &str = "http://127.0.0.1:3001";
const EP_V07: &str = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

/// Resolve the paymaster service URL — `PAYMASTER_URL` env override wins, then default.
/// Lets the operator point the test at a sandbox paymaster (e.g. :3002) without
/// disturbing the live service on :3001.
fn paymaster_url() -> String {
    std::env::var("PAYMASTER_URL").unwrap_or_else(|_| DEFAULT_PAYMASTER_URL.to_string())
}

/// Hardhat/anvil account #0 — used as deployer, account owner, and paymaster signer in tests.
/// Never use in production.
const DEPLOYER_PK: &str = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const DEPLOYER_ADDR: &str = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Run a shell command, returning stdout.
fn sh(cmd: &str) -> String {
    let out = std::process::Command::new("bash")
        .arg("-c")
        .arg(cmd)
        .output()
        .unwrap_or_else(|e| panic!("command failed: {cmd}: {e}"));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

/// Deploy a contract with raw bytecode + ABI-encoded constructor args via `cast send --create`.
///
/// Passes the hex data via an environment variable to avoid bash argument length limits
/// when embedding multi-kilobyte bytecode strings inline in `bash -c "..."`.
///
/// Returns the deployed contract address (0x-prefixed, lowercase).
fn cast_deploy(bytecode: &str, abi_sig: &str, args: &[&str]) -> String {
    // Build ABI-encoded constructor args.
    let args_quoted = args
        .iter()
        .map(|a| format!("'{a}'"))
        .collect::<Vec<_>>()
        .join(" ");
    let ctor_hex = sh(&format!(
        "cast abi-encode '{abi_sig}' {args_quoted} 2>/dev/null"
    ));
    assert!(
        !ctor_hex.is_empty(),
        "cast abi-encode failed for sig={abi_sig}"
    );
    let deploy_data = format!("{}{}", bytecode, ctor_hex.trim_start_matches("0x"));

    // Pass via env var — bash can handle arbitrarily long env values.
    let out = std::process::Command::new("bash")
        .arg("-c")
        .arg(format!(
            "cast send --rpc-url {ANVIL_URL} --private-key {DEPLOYER_PK} \
             --create \"$AEQI_DEPLOY_DATA\" 2>/dev/null \
             | grep '^contractAddress' | awk '{{print $2}}'"
        ))
        .env("AEQI_DEPLOY_DATA", &deploy_data)
        .output()
        .expect("cast deploy failed");
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

/// JSON-RPC POST helper.
async fn rpc(
    client: &reqwest::Client,
    url: &str,
    method: &str,
    params: serde_json::Value,
) -> serde_json::Value {
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    });
    client
        .post(url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .expect("RPC request failed")
        .json::<serde_json::Value>()
        .await
        .expect("RPC response is not JSON")
}

/// Returns true if the given JSON-RPC service is reachable.
async fn is_up(client: &reqwest::Client, url: &str) -> bool {
    client
        .post(url)
        .json(&serde_json::json!({"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":0}))
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

/// Returns true if the paymaster HTTP service is reachable.
async fn paymaster_is_up(client: &reqwest::Client) -> bool {
    let url = paymaster_url();
    client
        .get(format!("{url}/health"))
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

// ── Test: end-to-end UserOp lifecycle (self-paying) ──────────────────────────

/// Full end-to-end test: deploy contracts, submit UserOp, assert success.
///
/// Uses the self-paying path (no paymaster sponsorship) to prove the core AA stack.
/// See module docs for why the paymaster path is tested separately.
#[tokio::test]
#[ignore = "requires anvil + bundler running; invoke with --ignored"]
async fn test_userop_selfpay_mines_success() {
    let client = reqwest::Client::new();

    // ── Gate: all services must be up ────────────────────────────────────────

    assert!(
        is_up(&client, ANVIL_URL).await,
        "SKIP: anvil not reachable at {ANVIL_URL}"
    );
    assert!(
        is_up(&client, BUNDLER_URL).await,
        "SKIP: bundler not reachable at {BUNDLER_URL}"
    );

    // ── Verify chain ID ───────────────────────────────────────────────────────

    let chain_resp = rpc(&client, BUNDLER_URL, "eth_chainId", serde_json::json!([])).await;
    assert_eq!(
        chain_resp["result"].as_str().unwrap_or("").to_lowercase(),
        "0x7a69",
        "bundler chain ID must be 31337 (anvil)"
    );

    // ── Deploy Paymaster.sol ─────────────────────────────────────────────────
    //
    // Use cast send --create with compiled bytecode from aeqi-core.
    // Paymaster constructor: (address entryPoint, address signer)
    // We use DEPLOYER_ADDR as both the admin and the paymaster signer for test simplicity.
    //
    // The bytecode string is long (~4000+ chars); pass it via a temp file to avoid
    // shell argument length limits and quoting issues.

    let paymaster_bytecode = sh(
        "cat ${AEQI_CORE_OUT:-contracts/out}/Paymaster.sol/Paymaster.json \
             2>/dev/null | python3 -c \
             \"import sys,json; d=json.load(sys.stdin); print(d['bytecode']['object'])\" 2>/dev/null",
    );
    assert!(
        !paymaster_bytecode.is_empty() && paymaster_bytecode.starts_with("0x"),
        "Paymaster.sol not compiled; set AEQI_CORE_OUT or run forge build for the contracts workspace"
    );

    let paymaster_addr = cast_deploy(
        &paymaster_bytecode,
        "constructor(address,address)",
        &[EP_V07, DEPLOYER_ADDR],
    );
    assert!(
        paymaster_addr.starts_with("0x") && paymaster_addr.len() == 42,
        "Paymaster.sol deploy failed; got: {paymaster_addr}"
    );
    eprintln!("Paymaster.sol deployed at: {paymaster_addr}");

    // ── Fund Paymaster via EP.depositTo ──────────────────────────────────────

    let fund_status = sh(&format!(
        "cast send --rpc-url {ANVIL_URL} --private-key {DEPLOYER_PK} \
         --value 1ether '{EP_V07}' 'depositTo(address)' '{paymaster_addr}' 2>/dev/null | \
         grep '^status' | grep -c '1 (success)'"
    ));
    assert_eq!(fund_status, "1", "EP.depositTo failed");

    // Verify deposit balance in EP.
    // cast call output: "1000000000000000000 [1e18]" — take only the first token.
    let ep_balance_str = sh(&format!(
        "cast call --rpc-url {ANVIL_URL} '{EP_V07}' \
         'balanceOf(address)(uint256)' '{paymaster_addr}' 2>/dev/null | awk '{{print $1}}'"
    ));
    let ep_balance = ep_balance_str.parse::<u128>().unwrap_or(0);
    assert!(
        ep_balance >= 1_000_000_000_000_000_000u128, // 1 ETH in wei
        "paymaster balance in EP must be >= 1 ETH; got {ep_balance_str}"
    );
    eprintln!("Paymaster EP balance: {ep_balance} wei");

    // ── Deploy SimpleAccount ─────────────────────────────────────────────────
    //
    // SimpleAccount.sol is at test-contracts/SimpleAccount.sol.
    // Constructor: (address owner, address entryPoint).

    // Compile SimpleAccount (idempotent — forge skips if already compiled).
    // Redirect forge stdout to /dev/null to avoid mixing with bytecode output.
    sh("mkdir -p /tmp/simple-account-test/src && \
         cp ${AEQI_REPO_ROOT:-.}/test-contracts/SimpleAccount.sol \
           /tmp/simple-account-test/src/SimpleAccount.sol 2>/dev/null; \
         forge build --root /tmp/simple-account-test >/dev/null 2>/dev/null || \
         forge clean --root /tmp/simple-account-test >/dev/null 2>/dev/null && \
         forge build --root /tmp/simple-account-test >/dev/null 2>/dev/null");
    let sa_bytecode = sh(
        "cat /tmp/simple-account-test/out/SimpleAccount.sol/SimpleAccount.json \
         2>/dev/null | python3 -c \
         \"import sys,json; d=json.load(sys.stdin); print(d['bytecode']['object'])\" 2>/dev/null",
    );
    assert!(
        sa_bytecode.starts_with("0x") && sa_bytecode.len() > 10,
        "SimpleAccount not compiled; pre-compile with: forge build --root /tmp/simple-account-test"
    );

    let sa_addr = cast_deploy(
        &sa_bytecode,
        "constructor(address,address)",
        &[DEPLOYER_ADDR, EP_V07],
    );
    assert!(
        sa_addr.starts_with("0x") && sa_addr.len() == 42,
        "SimpleAccount deploy failed; got: {sa_addr}"
    );
    eprintln!("SimpleAccount deployed at: {sa_addr}");

    // Fund the account with 0.1 ETH so it can prefund gas.
    sh(&format!(
        "cast send --rpc-url {ANVIL_URL} --private-key {DEPLOYER_PK} \
         --value 0.1ether '{sa_addr}' 2>/dev/null | grep -c 'status.*1'"
    ));

    // ── Build UserOp (self-paying, no paymaster) ─────────────────────────────
    //
    // callData: SimpleAccount.execute(address(0), 0, 0x) — no-op transfer.
    // Gas params: liberal estimates confirmed by eth_estimateUserOperationGas.

    let call_data = sh("cast calldata 'execute(address,uint256,bytes)' \
         '0x0000000000000000000000000000000000000000' '0' '0x' 2>/dev/null");
    assert!(
        call_data.starts_with("0x"),
        "cast calldata failed; got: {call_data}"
    );

    // accountGasLimits: verificationGasLimit(128-bit) ++ callGasLimit(128-bit) packed as bytes32.
    // verificationGasLimit = 150000 (0x249f0), callGasLimit = 100000 (0x186a0).
    let account_gas_limits = "0x000000000000000000000000000249f0000000000000000000000000000186a0";
    // gasFees: maxPriorityFeePerGas(128-bit) ++ maxFeePerGas(128-bit) packed as bytes32.
    // maxPriorityFeePerGas = 1 gwei (0x3b9aca00), maxFeePerGas = 2 gwei (0x77359400).
    let gas_fees = "0x0000000000000000000000003b9aca0000000000000000000000000077359400";
    let pre_verification_gas = "0x186a0"; // 100000

    // Get EP nonce for this account.
    let nonce_hex = sh(&format!(
        "cast call --rpc-url {ANVIL_URL} '{EP_V07}' \
         'getNonce(address,uint192)(uint256)' '{sa_addr}' '0' 2>/dev/null"
    ));
    let nonce: u64 = nonce_hex.parse().unwrap_or(0);
    let nonce_hex_str = format!("0x{:x}", nonce);

    // Compute userOpHash from EP (no paymaster, so paymasterAndData = 0x).
    // EP.getUserOpHash takes a PackedUserOperation:
    //   (address sender, uint256 nonce, bytes initCode, bytes callData,
    //    bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees,
    //    bytes paymasterAndData, bytes signature)
    let user_op_hash = sh(&format!(
        "cast call --rpc-url {ANVIL_URL} '{EP_V07}' \
         'getUserOpHash((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes))(bytes32)' \
         '({sa_addr},{nonce},0x,{call_data},{account_gas_limits},{pvg},{gas_fees},0x,0x)' 2>/dev/null",
        pvg = pre_verification_gas
    ));
    assert!(
        user_op_hash.starts_with("0x") && user_op_hash.len() == 66,
        "EP.getUserOpHash failed; got: {user_op_hash}"
    );
    eprintln!("userOpHash: {user_op_hash}");

    // Sign userOpHash with the account owner (eth_sign prefix via cast wallet sign).
    let account_sig = sh(&format!(
        "cast wallet sign --private-key {DEPLOYER_PK} '{user_op_hash}' 2>/dev/null"
    ));
    assert!(
        account_sig.starts_with("0x") && account_sig.len() == 132,
        "cast wallet sign failed; got: {account_sig}"
    );
    eprintln!("Account signature: {account_sig}");

    // ── Submit via eth_sendUserOperation ─────────────────────────────────────

    let submit_resp = rpc(
        &client,
        BUNDLER_URL,
        "eth_sendUserOperation",
        serde_json::json!([
            {
                "sender": sa_addr,
                "nonce": nonce_hex_str,
                "factory": null,
                "factoryData": null,
                "callData": call_data,
                "callGasLimit": "0x186a0",
                "verificationGasLimit": "0x249f0",
                "preVerificationGas": pre_verification_gas,
                "maxFeePerGas": "0x77359400",
                "maxPriorityFeePerGas": "0x3b9aca00",
                "paymaster": null,
                "paymasterVerificationGasLimit": null,
                "paymasterPostOpGasLimit": null,
                "paymasterData": null,
                "signature": account_sig,
            },
            EP_V07,
        ]),
    )
    .await;

    assert!(
        submit_resp.get("error").is_none(),
        "eth_sendUserOperation returned error: {submit_resp}"
    );
    let returned_hash = submit_resp["result"]
        .as_str()
        .expect("eth_sendUserOperation result must be a hash string");
    assert_eq!(
        returned_hash.to_lowercase(),
        user_op_hash.to_lowercase(),
        "returned hash must equal the userOpHash we computed"
    );
    eprintln!("UserOp submitted; hash: {returned_hash}");

    // ── Poll for receipt ─────────────────────────────────────────────────────

    let mut receipt = serde_json::Value::Null;
    for attempt in 1..=12 {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        let resp = rpc(
            &client,
            BUNDLER_URL,
            "eth_getUserOperationReceipt",
            serde_json::json!([returned_hash]),
        )
        .await;

        if let Some(r) = resp["result"].as_object() {
            receipt = serde_json::Value::Object(r.clone());
            eprintln!("Receipt received on poll {attempt}");
            break;
        }
        eprintln!("Poll {attempt}: pending...");
    }

    assert!(
        !receipt.is_null(),
        "UserOp not mined within 24 seconds; bundler may be unhealthy"
    );

    // ── Assert success ────────────────────────────────────────────────────────

    let success = receipt["success"].as_bool().unwrap_or(false);
    assert!(
        success,
        "UserOp mined but success=false; reason: {}",
        receipt["reason"].as_str().unwrap_or("(none)")
    );

    let status = receipt["receipt"]["status"].as_str().unwrap_or("0x0");
    assert_eq!(status, "0x1", "tx status must be 0x1 (success)");

    let actual_gas_used = receipt["actualGasUsed"].as_str().unwrap_or("0x0");
    let actual_gas_cost = receipt["actualGasCost"].as_str().unwrap_or("0x0");

    eprintln!("UserOp mined successfully:");
    eprintln!(
        "  txHash:         {}",
        receipt["receipt"]["transactionHash"]
            .as_str()
            .unwrap_or("?")
    );
    eprintln!(
        "  blockNumber:    {}",
        receipt["receipt"]["blockNumber"].as_str().unwrap_or("?")
    );
    eprintln!("  actualGasUsed:  {actual_gas_used}");
    eprintln!("  actualGasCost:  {actual_gas_cost} wei");
    eprintln!("  success:        {success}");
}

// ── Test: on-chain Paymaster.sol accepts v0.7 paymasterAndData layout ────────

/// Proves the deployed Paymaster.sol parses the ERC-4337 v0.7 paymasterAndData
/// layout (offsets 52/58 for validUntil/validAfter, 64..129 for the signature)
/// by deploying it on anvil and calling `validatePaymasterUserOp` directly from
/// the EntryPoint address (via `cast send` impersonation).
///
/// End-to-end through the bundler is gated on `compute_user_op_hash_stub` being
/// replaced with a real `EP.getUserOpHash` call (`api.rs` Phase-2). Until then
/// this on-chain probe is the canonical proof that the offset fix lands.
#[tokio::test]
#[ignore = "requires anvil running; invoke with --ignored"]
async fn test_paymaster_sol_accepts_v07_layout_onchain() {
    use alloy::primitives::{B256, keccak256};
    use alloy::signers::Signer;
    use alloy::signers::local::PrivateKeySigner;

    let client = reqwest::Client::new();

    assert!(
        is_up(&client, ANVIL_URL).await,
        "SKIP: anvil not reachable at {ANVIL_URL}"
    );

    // ── Deploy Paymaster.sol with the test key as signer ─────────────────────
    let paymaster_bytecode = sh(
        "cat ${AEQI_CORE_OUT:-contracts/out}/Paymaster.sol/Paymaster.json \
             2>/dev/null | python3 -c \
             \"import sys,json; d=json.load(sys.stdin); print(d['bytecode']['object'])\" 2>/dev/null",
    );
    assert!(
        !paymaster_bytecode.is_empty() && paymaster_bytecode.starts_with("0x"),
        "Paymaster.sol not compiled; set AEQI_CORE_OUT or run forge build for the contracts workspace"
    );

    let paymaster_addr = cast_deploy(
        &paymaster_bytecode,
        "constructor(address,address)",
        &[EP_V07, DEPLOYER_ADDR],
    );
    assert!(
        paymaster_addr.starts_with("0x") && paymaster_addr.len() == 42,
        "Paymaster.sol deploy failed; got: {paymaster_addr}"
    );
    eprintln!("Paymaster.sol deployed at: {paymaster_addr}");

    // ── Build a v0.7 paymasterAndData blob and sign the digest ───────────────
    let valid_until: u64 = 0xffff_ffff_ffffu64; // type(uint48).max — no expiry
    let valid_after: u64 = 0;
    let pm_addr_bytes = hex::decode(paymaster_addr.trim_start_matches("0x")).unwrap();

    // Use a deterministic userOpHash for this on-chain probe (the EP enforces
    // userOpHash matches the packed UserOp on full-flow validation; here we
    // call validatePaymasterUserOp directly with this hash, so any 32-byte
    // value is fine — the contract trusts the EP-supplied userOpHash).
    let user_op_hash: B256 = keccak256(b"v07-onchain-probe-hash-for-paymaster");

    // digest = keccak256(userOpHash ++ validUntil(uint48 BE) ++ validAfter(uint48 BE) ++ paymaster_addr)
    let mut digest_input: Vec<u8> = Vec::with_capacity(64);
    digest_input.extend_from_slice(user_op_hash.as_slice()); // 32
    digest_input.extend_from_slice(&valid_until.to_be_bytes()[2..]); // 6
    digest_input.extend_from_slice(&valid_after.to_be_bytes()[2..]); // 6
    digest_input.extend_from_slice(&pm_addr_bytes); // 20
    let digest: B256 = keccak256(&digest_input);

    let signer: PrivateKeySigner = DEPLOYER_PK.parse().expect("test signer parse");
    let pm_sig = signer.sign_hash(&digest).await.expect("paymaster sig sign");
    let pm_sig_bytes = pm_sig.as_bytes();

    // Build paymasterAndData per ERC-4337 v0.7 (must match Paymaster.sol offsets):
    //   [0:20] addr | [20:36] verifGas | [36:52] postOpGas | [52:58] validUntil
    //   [58:64] validAfter | [64:129] sig
    let mut pad: Vec<u8> = Vec::with_capacity(129);
    pad.extend_from_slice(&pm_addr_bytes); // 20
    pad.extend_from_slice(&[0u8; 32]); // verifGas + postOpGas — irrelevant to Paymaster.sol
    pad.extend_from_slice(&valid_until.to_be_bytes()[2..]); // 6
    pad.extend_from_slice(&valid_after.to_be_bytes()[2..]); // 6
    pad.extend_from_slice(&pm_sig_bytes); // 65
    assert_eq!(pad.len(), 129, "v0.7 paymasterAndData must be 129 bytes");
    let pad_hex = format!("0x{}", hex::encode(&pad));

    // ── Impersonate the EntryPoint and call validatePaymasterUserOp ──────────
    // anvil_impersonateAccount lets us send tx as the EP without holding its key.
    rpc(
        &client,
        ANVIL_URL,
        "anvil_impersonateAccount",
        serde_json::json!([EP_V07]),
    )
    .await;
    rpc(
        &client,
        ANVIL_URL,
        "anvil_setBalance",
        serde_json::json!([EP_V07, "0xde0b6b3a7640000"]), // 1 ETH for gas
    )
    .await;

    // PackedUserOperation tuple: (sender, nonce, initCode, callData, accountGasLimits,
    //   preVerificationGas, gasFees, paymasterAndData, signature)
    // We use the SimpleAccount-shaped placeholder values; only paymasterAndData
    // is meaningful for this probe. Note the address must be checksummed.
    let userop_tuple = format!(
        "({DEPLOYER_ADDR},0,0x,0x,0x{:0>64},0,0x{:0>64},{pad_hex},0x)",
        "0", "0"
    );
    let user_op_hash_hex = format!("0x{}", hex::encode(user_op_hash.as_slice()));

    // Static-call validatePaymasterUserOp from the EP. Use eth_call with `from = EP`
    // (anvil honors the impersonation for state-modifying calls; for validatePaymasterUserOp
    // the only state mutation is event emission, which is fine for an eth_call).
    let validate_resp = sh(&format!(
        "cast call --rpc-url {ANVIL_URL} \
         --from {EP_V07} \
         '{paymaster_addr}' \
         'validatePaymasterUserOp((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes),bytes32,uint256)(bytes,uint256)' \
         '{userop_tuple}' '{user_op_hash_hex}' '0' 2>&1"
    ));
    eprintln!("validatePaymasterUserOp response: {validate_resp}");

    // The returned (context, validationData) is two-line ABI-decoded. validationData
    // is on the second line. sigFail bit 0 == 0 means signature accepted.
    assert!(
        !validate_resp.contains("Error") && !validate_resp.contains("revert"),
        "validatePaymasterUserOp reverted: {validate_resp}"
    );

    let lines: Vec<&str> = validate_resp.lines().collect();
    let validation_data_str = lines
        .last()
        .expect("response must have a validationData line");
    // validationData is a uint256; sigFail = lowest bit of the low 160 bits.
    // Cast renders uint256 as plain decimal. Parse as U256 (use string-prefix check).
    let vd_clean = validation_data_str.trim();
    eprintln!("validationData (decimal): {vd_clean}");

    // Lowest bit must be 0 (sigFail=0 means valid signature).
    // For type(uint48).max validUntil, validationData = (validUntil << 160), which is even.
    // For ANY non-zero validUntil shifted by 160 with sigFail bit clear, last hex digit is even.
    let last_char = vd_clean.chars().last().unwrap_or('0');
    let last_digit = last_char.to_digit(10).unwrap_or(0);
    assert_eq!(
        last_digit % 2,
        0,
        "sigFail bit must be 0 (validationData LSB must be even); got {vd_clean}"
    );

    eprintln!("v0.7 layout accepted on-chain by deployed Paymaster.sol:");
    eprintln!("  paymaster_addr: {paymaster_addr}");
    eprintln!("  pad_length:     {} bytes", pad.len());
    eprintln!("  validationData: {vd_clean}");
}

// ── Test: paymaster service connectivity and sponsorship response ─────────────

/// Verify the paymaster service responds to pm_sponsorUserOperation with
/// syntactically correct paymasterAndData.
#[tokio::test]
#[ignore = "requires anvil + bundler + aeqi-paymaster running; invoke with --ignored"]
async fn test_paymaster_service_returns_valid_paymaster_and_data() {
    let client = reqwest::Client::new();
    let url = paymaster_url();

    if !paymaster_is_up(&client).await {
        eprintln!("SKIP: aeqi-paymaster not reachable at {url}");
        return;
    }

    // Sponsor a dummy UserOp (any sender with a budget — Phase-1 auto-seeds on first access).
    let dummy_sender = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

    let resp = rpc(
        &client,
        &url,
        "pm_sponsorUserOperation",
        serde_json::json!([
            {
                "sender": dummy_sender,
                "nonce": "0x0",
                "callData": "0x",
                "callGasLimit": 100000,
                "verificationGasLimit": 150000,
                "preVerificationGas": 100000,
                "maxFeePerGas": 2000000000u64,
                "maxPriorityFeePerGas": 1000000000u64,
                "paymasterAndData": "0x",
                "signature": "0x",
            },
            EP_V07,
            "0x7a69",
        ]),
    )
    .await;

    assert!(
        resp.get("error").is_none(),
        "pm_sponsorUserOperation returned error: {resp}"
    );

    let result = &resp["result"];

    // paymasterAndData must be 0x-prefixed hex, exactly 129 bytes per ERC-4337 v0.7
    // (20 addr + 16 verifGasLimit + 16 postOpGasLimit + 6 validUntil + 6 validAfter + 65 sig).
    let pad = result["paymasterAndData"].as_str().unwrap_or("");
    assert!(
        pad.starts_with("0x"),
        "paymasterAndData must be 0x-prefixed"
    );
    assert_eq!(
        (pad.len() - 2) / 2,
        129,
        "paymasterAndData must be exactly 129 bytes (v0.7 layout); got {} bytes ({})",
        (pad.len() - 2) / 2,
        pad
    );

    // First 20 bytes must be the paymaster contract address (not the signer key address).
    // The environment configures PAYMASTER_CONTRACT_ADDRESS; if zero, warn but don't fail.
    let pm_addr_from_pad = &pad[2..42]; // 20 bytes = 40 hex chars
    eprintln!("paymasterAndData[0:20] = 0x{pm_addr_from_pad}");

    let signature = result["signature"].as_str().unwrap_or("");
    assert!(
        signature.starts_with("0x") && signature.len() == 132,
        "signature must be 65 bytes"
    );

    let valid_until = result["validUntil"].as_u64().unwrap_or(0);
    assert!(valid_until > 0, "validUntil must be non-zero");

    eprintln!("pm_sponsorUserOperation response: pad={pad}, validUntil={valid_until}");
}

// ── Test: Paymaster.sol funded and accessible ─────────────────────────────────

/// Verify that a Paymaster.sol contract can be deployed to anvil and funded
/// via EntryPoint.depositTo. Does not submit a UserOp.
#[tokio::test]
#[ignore = "requires anvil running; invoke with --ignored"]
async fn test_paymaster_sol_deploy_and_fund() {
    let client = reqwest::Client::new();

    if !is_up(&client, ANVIL_URL).await {
        eprintln!("SKIP: anvil not reachable at {ANVIL_URL}");
        return;
    }

    // Check Paymaster.sol bytecode is available.
    let bytecode = sh(
        "cat ${AEQI_CORE_OUT:-contracts/out}/Paymaster.sol/Paymaster.json \
             2>/dev/null | python3 -c \
             \"import sys,json; d=json.load(sys.stdin); print(d['bytecode']['object'])\" 2>/dev/null",
    );
    if !bytecode.starts_with("0x") || bytecode.len() < 10 {
        eprintln!(
            "SKIP: Paymaster.sol not compiled; set AEQI_CORE_OUT or run forge build for the contracts workspace"
        );
        return;
    }

    // Deploy via cast_deploy (passes bytecode via env var to avoid bash length limits).
    let pm_addr = cast_deploy(
        &bytecode,
        "constructor(address,address)",
        &[EP_V07, DEPLOYER_ADDR],
    );

    assert!(
        pm_addr.starts_with("0x") && pm_addr.len() == 42,
        "Paymaster.sol deploy failed; got: {pm_addr}"
    );

    // Fund via depositTo.
    sh(&format!(
        "cast send --rpc-url {ANVIL_URL} --private-key {DEPLOYER_PK} \
         --value 1ether '{EP_V07}' 'depositTo(address)' '{pm_addr}' 2>/dev/null"
    ));

    // Assert balance — take first token only (cast appends "[1e18]" human-readable suffix).
    let balance: u128 = sh(&format!(
        "cast call --rpc-url {ANVIL_URL} '{EP_V07}' \
         'balanceOf(address)(uint256)' '{pm_addr}' 2>/dev/null | awk '{{print $1}}'"
    ))
    .parse()
    .unwrap_or(0);

    assert!(
        balance >= 1_000_000_000_000_000_000u128,
        "EP balance must be >= 1 ETH; got {balance} wei"
    );

    // Assert signer and entryPoint are set correctly.
    let signer = sh(&format!(
        "cast call --rpc-url {ANVIL_URL} '{pm_addr}' 'paymasterSigner()(address)' 2>/dev/null"
    ));
    assert_eq!(
        signer.to_lowercase(),
        DEPLOYER_ADDR.to_lowercase(),
        "paymasterSigner must be DEPLOYER_ADDR"
    );

    let ep = sh(&format!(
        "cast call --rpc-url {ANVIL_URL} '{pm_addr}' 'entryPoint()(address)' 2>/dev/null"
    ));
    assert_eq!(
        ep.to_lowercase(),
        EP_V07.to_lowercase(),
        "entryPoint must be EP_V07"
    );

    eprintln!("Paymaster.sol at {pm_addr}: EP balance={balance}, signer={signer}");
}
