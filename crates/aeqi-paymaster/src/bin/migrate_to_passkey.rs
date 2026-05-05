//! migrate-to-passkey — CLI tool for Phase-1 → Phase-2 wallet migration.
//!
//! Adds a P-256 (passkey) signer to an existing AEQI Entity that currently uses
//! a custodial EOA signer.  After this tool runs successfully, the user can sign
//! UserOps with their passkey; the EOA signer can then be removed at any time.
//!
//! ## Usage
//!
//! ```text
//! migrate-to-passkey \
//!   --entity    0xENTITY_CONTRACT_ADDRESS  \
//!   --pubkey    04<64-byte-hex-P256-key>   \
//!   --eoa-key   <hex-private-key>          \
//!   --bundler   http://127.0.0.1:3000      \
//!   --entry-point 0x0000000071727De22E5E9d8BAf0edAc6f37da032 \
//!   --chain-id  31337                      \
//!   [--dry-run]
//! ```
//!
//! ## What happens
//!
//! 1. Parses and validates all inputs.
//! 2. ABI-encodes `addSigner(P256, pubkeyX, pubkeyY)` as the UserOp calldata.
//! 3. Signs the UserOp with the existing EOA key.
//! 4. Submits to the bundler (`eth_sendUserOperation`).
//! 5. Polls until a receipt appears.
//! 6. Prints the UserOp hash and the transaction hash.
//!
//! ## Safety
//!
//! This tool NEVER removes the existing EOA signer.  After a successful run the
//! Entity has two signers (EOA + passkey).  The operator removes the EOA signer
//! from the application layer at a later, controlled time once passkey login is
//! verified.
//!
//! ## Dry run
//!
//! Pass `--dry-run` to print the encoded UserOp without submitting.  Useful for
//! inspecting calldata before committing to a live migration.

use anyhow::{Context, Result};
use clap::Parser;
use tracing_subscriber::EnvFilter;

use aeqi_paymaster::migrate::{MigrationParams, parse_p256_pubkey, run_migration};

/// Phase-1 → Phase-2 wallet migration: add passkey signer to an AEQI Entity.
#[derive(Debug, Parser)]
#[command(name = "migrate-to-passkey", version, about)]
struct Cli {
    /// Entity contract address (the account being migrated).
    #[arg(long)]
    entity: String,

    /// P-256 public key, hex-encoded.
    /// Accepted formats:
    ///   - 65 bytes uncompressed: `04<32-byte-X><32-byte-Y>`
    ///   - 64 bytes raw:          `<32-byte-X><32-byte-Y>`
    #[arg(long)]
    pubkey: String,

    /// Hex-encoded secp256k1 private key for the current EOA signer (no 0x prefix).
    #[arg(long)]
    eoa_key: String,

    /// Bundler JSON-RPC URL.
    #[arg(long, default_value = "http://127.0.0.1:3000")]
    bundler: String,

    /// ERC-4337 EntryPoint contract address.
    #[arg(long, default_value = "0x0000000071727De22E5E9d8BAf0edAc6f37da032")]
    entry_point: String,

    /// Chain ID (decimal).
    #[arg(long, default_value_t = 31337)]
    chain_id: u64,

    /// Print the UserOp without submitting to the bundler.
    #[arg(long, default_value_t = false)]
    dry_run: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let cli = Cli::parse();

    // Parse entity address.
    let entity_address: alloy::primitives::Address = cli
        .entity
        .trim_start_matches("0x")
        .parse()
        .context("invalid --entity address")?;

    // Parse EntryPoint address.
    let entry_point: alloy::primitives::Address = cli
        .entry_point
        .trim_start_matches("0x")
        .parse()
        .context("invalid --entry-point address")?;

    // Parse P-256 public key.
    let (pubkey_x, pubkey_y) = parse_p256_pubkey(&cli.pubkey).context("invalid --pubkey")?;

    let params = MigrationParams {
        entity_address,
        pubkey_x,
        pubkey_y,
        bundler_url: cli.bundler,
        entry_point,
        chain_id: cli.chain_id,
        eoa_private_key: cli.eoa_key,
        dry_run: cli.dry_run,
    };

    let receipt = run_migration(&params).await?;

    println!("user_op_hash: {}", receipt.user_op_hash);
    if let Some(tx) = &receipt.tx_hash {
        println!("tx_hash:      {tx}");
        println!(
            "Migration complete. Entity {} now has a P-256 signer.",
            params.entity_address
        );
    } else {
        println!("Dry run — UserOp not submitted.");
    }

    Ok(())
}
