//! aeqi-indexer — Solana indexer for the AEQI protocol.
//!
//! Subscribes to logs of all 11 AEQI programs via `logsSubscribe` (WS) and
//! decodes Anchor events from the `Program data:` lines via a pre-computed
//! discriminator registry. Projects events into an idempotent SQLite sink.
//!
//! Architecture: hits a public Solana RPC (Helius / Triton / Solana
//! Foundation), per `feedback_use_public_solana_rpc.md` — we run the
//! indexer service ourselves but don't run a validator/RPC node.

mod backfill;
mod manifest;
mod registry;
mod sink;

use anyhow::{Context, Result};
use clap::Parser;
use futures::StreamExt;
use manifest::{Manifest, DEFAULT_CLUSTER};
use solana_client::nonblocking::pubsub_client::PubsubClient;
use solana_client::rpc_config::{RpcTransactionLogsConfig, RpcTransactionLogsFilter};
use solana_sdk::commitment_config::CommitmentConfig;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;
use tracing::{info, warn};

#[derive(Parser, Debug)]
#[command(name = "aeqi-indexer", about = "Solana log indexer for the AEQI protocol")]
struct Args {
    /// WebSocket RPC URL
    #[arg(long, env = "AEQI_INDEXER_WS", default_value = "ws://127.0.0.1:9900")]
    ws_url: String,

    /// Commitment level for live subscription (confirmed | finalized)
    #[arg(long, env = "AEQI_INDEXER_COMMITMENT", default_value = "confirmed")]
    commitment: String,

    /// SQLite database path
    #[arg(long, env = "AEQI_INDEXER_DB", default_value = "./aeqi-indexer.db")]
    db: String,

    /// HTTP RPC URL for backfill (getSignaturesForAddress + getTransaction)
    #[arg(long, env = "AEQI_INDEXER_RPC", default_value = "http://127.0.0.1:9899")]
    rpc_url: String,

    /// Skip the historical backfill on startup (live tail only)
    #[arg(long, env = "AEQI_INDEXER_SKIP_BACKFILL", default_value_t = false)]
    skip_backfill: bool,

    /// Solana cluster name used to resolve the deployment manifest
    /// (`deployments/<cluster>.json`) and to look up Anchor.toml's
    /// `[programs.<cluster>]` table for the consistency check.
    #[arg(long, env = "AEQI_SOLANA_CLUSTER", default_value = DEFAULT_CLUSTER)]
    cluster: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let args = Args::parse();

    // Load the canonical program manifest before anything else. Fail
    // fast on missing/malformed file or drift against Anchor.toml —
    // the indexer subscribing to the wrong program IDs is the worst
    // kind of silent failure.
    let manifest_path = Manifest::resolve_path(&args.cluster);
    let manifest = Manifest::load(&manifest_path)
        .with_context(|| format!("loading deployment manifest at {}", manifest_path.display()))?;
    if manifest.cluster != args.cluster {
        anyhow::bail!(
            "manifest cluster {:?} at {} does not match --cluster {:?}",
            manifest.cluster,
            manifest_path.display(),
            args.cluster
        );
    }
    match manifest.assert_matches_anchor_toml(&manifest_path, None) {
        Ok(toml_path) => info!(
            manifest = %manifest_path.display(),
            anchor_toml = %toml_path.display(),
            programs = manifest.programs.len(),
            "manifest validated against Anchor.toml"
        ),
        Err(e) => {
            // Anchor.toml is the secondary source of truth; treat
            // missing-file as a soft-fail (e.g. installs that ship
            // only the binary + manifest), but actual content drift
            // is fatal.
            let chain = format!("{e:#}");
            let missing = chain.contains("failed to read");
            if missing {
                warn!(
                    manifest = %manifest_path.display(),
                    error = %chain,
                    "Anchor.toml unreadable — skipping consistency check"
                );
            } else {
                return Err(e);
            }
        }
    }

    info!(
        cluster = %args.cluster,
        manifest = %manifest_path.display(),
        programs = manifest.programs.len(),
        ws_url = %args.ws_url,
        commitment = %args.commitment,
        db = %args.db,
        events_known = registry::event_count(),
        "starting aeqi-indexer"
    );

    let sink = std::sync::Arc::new(sink::Sink::open(&args.db)?);
    info!(prior_events = sink.event_count()?, "sink opened");

    // Historical backfill — replay any events that happened before the
    // indexer started (or while it was offline). Idempotent via the sink's
    // UNIQUE(signature, program, event_type) constraint.
    if !args.skip_backfill {
        let rpc = solana_client::nonblocking::rpc_client::RpcClient::new(args.rpc_url.clone());
        for program in &manifest.programs {
            let pid = Pubkey::from_str(&program.pubkey).with_context(|| {
                format!("manifest pubkey for {} is not valid base58", program.name)
            })?;
            match backfill::backfill_program(&rpc, &pid, &program.name, sink.clone()).await {
                Ok(n) => info!(program = %program.name, inserted = n, "backfill complete"),
                Err(e) => {
                    warn!(?e, program = %program.name, "backfill failed — continuing to live tail")
                }
            }
        }
    } else {
        info!("--skip-backfill set — going straight to live tail");
    }

    let commitment = match args.commitment.as_str() {
        "finalized" => CommitmentConfig::finalized(),
        _ => CommitmentConfig::confirmed(),
    };

    // Leak the client into 'static — the indexer runs for the lifetime of
    // the process so this is fine, and it lets each subscription stream
    // outlive the local function scope (required by tokio::spawn's
    // 'static bound).
    let client: &'static PubsubClient = Box::leak(Box::new(PubsubClient::new(&args.ws_url).await?));
    let mut handles = Vec::new();

    for program in &manifest.programs {
        let pid = Pubkey::from_str(&program.pubkey).with_context(|| {
            format!("manifest pubkey for {} is not valid base58", program.name)
        })?;
        let name = program.name.clone();
        let resume_slot = sink.cursor(&name)?;
        info!(program = %name, program_id = %pid, ?resume_slot, "subscribing");

        let filter = RpcTransactionLogsFilter::Mentions(vec![pid.to_string()]);
        let cfg = RpcTransactionLogsConfig { commitment: Some(commitment) };
        let (mut sub, _unsub) = client.logs_subscribe(filter, cfg).await?;

        let sink_for_task = sink.clone();
        let handle = tokio::spawn(async move {
            while let Some(resp) = sub.next().await {
                let slot = resp.context.slot;
                if let Some(err) = &resp.value.err {
                    warn!(program = %name, slot, ?err, "tx error — skipping");
                    continue;
                }
                for (log_index, line) in resp.value.logs.iter().enumerate() {
                    if let Some(rest) = line.strip_prefix("Program data: ") {
                        match base64::Engine::decode(
                            &base64::engine::general_purpose::STANDARD,
                            rest,
                        ) {
                            Ok(bytes) if bytes.len() >= 8 => {
                                let payload = &bytes[8..];
                                match registry::lookup(&pid, &bytes[..8]) {
                                    Some(meta) => {
                                        let recorded = sink_for_task.record_event(
                                            meta.program,
                                            meta.event,
                                            slot,
                                            &resp.value.signature,
                                            log_index as u32,
                                            rest,
                                        );
                                        match recorded {
                                            Ok(true) => info!(
                                                program = %meta.program,
                                                event = %meta.event,
                                                slot,
                                                sig = %resp.value.signature,
                                                payload_bytes = payload.len(),
                                                "anchor event recorded"
                                            ),
                                            Ok(false) => {
                                                // dedup hit — replay or reorg
                                            }
                                            Err(e) => warn!(?e, "sink.record_event failed"),
                                        }
                                    }
                                    None => {
                                        warn!(
                                            program = %name,
                                            slot,
                                            sig = %resp.value.signature,
                                            disc = %hex(&bytes[..8]),
                                            "unknown discriminator (event registered after indexer build?)"
                                        );
                                    }
                                }
                            }
                            Ok(_) => {}
                            Err(e) => warn!(?e, "failed to base64-decode Program data"),
                        }
                    }
                }
                if let Err(e) = sink_for_task.bump_cursor(&name, slot) {
                    warn!(?e, "sink.bump_cursor failed");
                }
            }
            warn!(program = %name, "log subscription ended");
        });
        handles.push(handle);
    }

    for h in handles {
        let _ = h.await;
    }
    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        use std::fmt::Write;
        let _ = write!(s, "{:02x}", b);
    }
    s
}
