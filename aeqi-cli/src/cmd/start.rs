use anyhow::Result;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crate::cli::{DaemonAction, WebAction};
use crate::helpers::load_config_with_agents;

/// Run daemon and web server concurrently in a single process.
pub(crate) async fn cmd_start(config_path: &Option<PathBuf>, bind: Option<String>) -> Result<()> {
    print_starting(config_path, bind.as_deref());

    // Spawn a background readiness probe so the user sees "Ready" (or a
    // specific failure) the moment the daemon socket and web bind are
    // both up. The probe self-terminates when the deadline elapses or
    // both signals are healthy.
    let probe_config = config_path.clone();
    let probe_bind = bind.clone();
    tokio::spawn(async move {
        probe_readiness(probe_config.as_ref(), probe_bind.as_deref()).await;
    });

    let web_action = WebAction::Start { bind };

    tokio::select! {
        result = super::daemon::cmd_daemon(config_path, DaemonAction::Start) => result,
        result = async {
            // Brief delay for daemon to bind the IPC socket before
            // the web server starts accepting requests.
            tokio::time::sleep(Duration::from_millis(500)).await;
            super::web::cmd_web(config_path, web_action).await
        } => result,
    }
}

/// Print the at-launch context the user needs (URL, providers, auth)
/// AND mark daemon / web as `starting`. The actual `ready` line comes
/// later from `probe_readiness` once those services respond.
fn print_starting(config_path: &Option<PathBuf>, bind_override: Option<&str>) {
    println!("Starting AEQI (daemon + web)...");

    let Ok((config, _path)) = load_config_with_agents(config_path) else {
        println!("(skipping readiness summary: config not loaded)");
        return;
    };

    let bind = bind_override.unwrap_or(&config.web.bind).to_string();
    let url = bind_to_url(&bind);
    println!("  Web UI:   {url} (starting…)");
    println!(
        "  Daemon:   starting… ({} agent(s) configured)",
        config.agents.len()
    );

    let provider_status = describe_providers(&config);
    println!("  Provider: {provider_status}");

    let mut idea_db = config.data_dir().join("aeqi.db");
    if idea_db.is_relative() {
        idea_db = std::env::current_dir().unwrap_or_default().join(&idea_db);
    }
    if idea_db.exists() {
        println!("  Ideas:    aeqi.db at {}", idea_db.display());
    } else {
        println!(
            "  Ideas:    aeqi.db will be created at {} on first write",
            idea_db.display()
        );
    }

    if std::env::var("AEQI_WEB_SECRET")
        .ok()
        .filter(|s| !s.is_empty())
        .is_some()
    {
        println!("  Auth:     persistent secret from AEQI_WEB_SECRET");
    } else if config.web.auth_secret.as_deref().unwrap_or("").is_empty() {
        println!(
            "  Auth:     ephemeral secret (sign-ins won't survive restart). Run `aeqi setup` to persist one."
        );
    } else {
        println!("  Auth:     persistent secret from config");
    }
    println!();
}

/// Background probe: poll the IPC socket and the web bind until both
/// respond, or until a 10s deadline elapses. Prints exactly one of
/// `Ready` / `Daemon failed to start` / `Web bind never accepted` so
/// the user knows what state they're in. Never panics — start.rs
/// already owns the daemon lifecycle.
async fn probe_readiness(config_path: Option<&PathBuf>, bind_override: Option<&str>) {
    let Ok((config, _)) = load_config_with_agents(&config_path.cloned()) else {
        return;
    };
    let socket_path = config.data_dir().join("rm.sock");
    let bind = bind_override.unwrap_or(&config.web.bind).to_string();
    let url = bind_to_url(&bind);

    let deadline = Instant::now() + Duration::from_secs(10);
    let mut daemon_ready = false;
    let mut web_ready = false;

    while Instant::now() < deadline {
        if !daemon_ready && ipc_socket_responsive(&socket_path).await {
            daemon_ready = true;
        }
        if !web_ready && tcp_bind_responsive(&bind).await {
            web_ready = true;
        }
        if daemon_ready && web_ready {
            break;
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }

    match (daemon_ready, web_ready) {
        (true, true) => println!("  Ready:    daemon + web up — open {url}"),
        (true, false) => println!(
            "  WARN:     daemon up but web bind {bind} never accepted within 10s — \
             check for port conflicts"
        ),
        (false, true) => println!(
            "  WARN:     web up but daemon IPC socket {} never appeared — \
             scheduled work won't run",
            socket_path.display()
        ),
        (false, false) => {
            println!("  ERROR:    neither daemon nor web responded within 10s — see logs above")
        }
    }
}

#[cfg(unix)]
async fn ipc_socket_responsive(socket_path: &Path) -> bool {
    if !socket_path.exists() {
        return false;
    }
    tokio::net::UnixStream::connect(socket_path).await.is_ok()
}

#[cfg(not(unix))]
async fn ipc_socket_responsive(_socket_path: &Path) -> bool {
    // Non-Unix builds skip this signal.
    true
}

async fn tcp_bind_responsive(bind: &str) -> bool {
    // Try to OPEN the bind — the daemon already has it, so a successful
    // bind from us means it's NOT yet listening. Inverse logic: we
    // connect to it as a client; success = the daemon is accepting.
    let target = bind.replace("0.0.0.0", "127.0.0.1").replace("::", "[::1]");
    matches!(
        tokio::time::timeout(
            Duration::from_millis(200),
            tokio::net::TcpStream::connect(&target),
        )
        .await,
        Ok(Ok(_))
    )
}

fn bind_to_url(bind: &str) -> String {
    let (host, port) = bind.rsplit_once(':').unwrap_or(("localhost", "8400"));
    let host = match host {
        "0.0.0.0" | "[::]" | "::" | "" => "localhost",
        other => other,
    };
    format!("http://{host}:{port}")
}

fn describe_providers(config: &aeqi_core::AEQIConfig) -> String {
    let mut configured = Vec::new();
    let mut missing_keys = Vec::new();
    if let Some(ref or) = config.providers.openrouter {
        if or.api_key.is_empty() {
            missing_keys.push("OPENROUTER_API_KEY");
        } else {
            configured.push("openrouter");
        }
    }
    if let Some(ref a) = config.providers.anthropic {
        if a.api_key.is_empty() {
            missing_keys.push("ANTHROPIC_API_KEY");
        } else {
            configured.push("anthropic");
        }
    }
    if config.providers.ollama.is_some() {
        configured.push("ollama");
    }
    if configured.is_empty() && missing_keys.is_empty() {
        return "no providers configured (chat disabled until [providers.*] is set)".to_string();
    }
    let mut parts = Vec::new();
    if !configured.is_empty() {
        parts.push(format!("ready: {}", configured.join(", ")));
    }
    if !missing_keys.is_empty() {
        parts.push(format!(
            "missing key(s) {}: chat disabled for those providers until configured via `aeqi secrets set <NAME> <value>`",
            missing_keys.join(", ")
        ));
    }
    parts.join(" | ")
}
