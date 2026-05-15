use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;

/// Client for the AEQI daemon's Unix socket IPC.
/// Protocol: one JSON line in → one JSON line out (or multiple for streaming).
#[derive(Debug, Clone)]
pub struct IpcClient {
    socket_path: PathBuf,
}

impl IpcClient {
    pub fn new(socket_path: PathBuf) -> Self {
        Self { socket_path }
    }

    /// Derive socket path from a data directory.
    pub fn from_data_dir(data_dir: &Path) -> Self {
        Self::new(data_dir.join("rm.sock"))
    }

    /// Get the socket path for direct connections.
    pub fn socket_path(&self) -> &Path {
        &self.socket_path
    }

    /// Default per-request timeout for the IPC client. Most verbs return
    /// in <100ms; LLM-fronting verbs (architect.draft, architect.refine)
    /// override via [`request_with_timeout`].
    const DEFAULT_TIMEOUT_SECS: u64 = 10;

    /// Send a JSON request and get a JSON response (with the default 10s timeout).
    pub async fn request(&self, request: &serde_json::Value) -> Result<serde_json::Value> {
        self.request_with_timeout(request, Self::DEFAULT_TIMEOUT_SECS)
            .await
    }

    /// Send a JSON request with an explicit timeout (in seconds). Used by
    /// LLM-fronting verbs that legitimately take 5-30s (architect.draft).
    pub async fn request_with_timeout(
        &self,
        request: &serde_json::Value,
        timeout_secs: u64,
    ) -> Result<serde_json::Value> {
        tokio::time::timeout(
            std::time::Duration::from_secs(timeout_secs),
            self.request_inner(request),
        )
        .await
        .map_err(|_| anyhow::anyhow!("IPC request timed out after {}s", timeout_secs))?
    }

    async fn request_inner(&self, request: &serde_json::Value) -> Result<serde_json::Value> {
        let stream = connect_with_retry(&self.socket_path).await?;

        let (reader, mut writer) = stream.into_split();
        let mut req_bytes = serde_json::to_vec(request)?;
        req_bytes.push(b'\n');
        writer.write_all(&req_bytes).await?;

        let mut lines = BufReader::new(reader).lines();
        let Some(line) = lines.next_line().await? else {
            anyhow::bail!("IPC socket closed without response");
        };

        let response: serde_json::Value = serde_json::from_str(&line)?;
        Ok(response)
    }

    /// Send a request and read streaming JSON lines until the connection closes
    /// or a line with `"done": true` is received. Each line is passed to the callback.
    pub async fn request_stream<F>(
        &self,
        request: &serde_json::Value,
        mut on_event: F,
    ) -> Result<()>
    where
        F: FnMut(serde_json::Value) -> bool,
    {
        let stream = connect_with_retry(&self.socket_path).await?;

        let (reader, mut writer) = stream.into_split();
        let mut req_bytes = serde_json::to_vec(request)?;
        req_bytes.push(b'\n');
        writer.write_all(&req_bytes).await?;

        let mut lines = BufReader::new(reader).lines();
        while let Some(line) = lines.next_line().await? {
            let event: serde_json::Value = serde_json::from_str(&line)?;
            let is_done = event.get("done").and_then(|v| v.as_bool()).unwrap_or(false);
            let should_continue = on_event(event);
            if is_done || !should_continue {
                break;
            }
        }

        Ok(())
    }

    /// Convenience: send a simple command with no extra params.
    pub async fn cmd(&self, cmd: &str) -> Result<serde_json::Value> {
        self.request(&serde_json::json!({"cmd": cmd})).await
    }

    /// Convenience: send a command with params merged in.
    pub async fn cmd_with(
        &self,
        cmd: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value> {
        let mut req = params;
        req["cmd"] = serde_json::Value::String(cmd.to_string());
        self.request(&req).await
    }

    /// Send a command with params and an explicit timeout (in seconds).
    /// Used by LLM-fronting verbs (architect.draft, architect.refine)
    /// where the default 10s timeout is too aggressive for upstream LLM
    /// latency.
    pub async fn cmd_with_timeout(
        &self,
        cmd: &str,
        params: serde_json::Value,
        timeout_secs: u64,
    ) -> Result<serde_json::Value> {
        let mut req = params;
        req["cmd"] = serde_json::Value::String(cmd.to_string());
        self.request_with_timeout(&req, timeout_secs).await
    }

    /// Send a streaming command — returns events via callback until done.
    pub async fn cmd_stream<F>(
        &self,
        cmd: &str,
        params: serde_json::Value,
        on_event: F,
    ) -> Result<()>
    where
        F: FnMut(serde_json::Value) -> bool,
    {
        let mut req = params;
        req["cmd"] = serde_json::Value::String(cmd.to_string());
        self.request_stream(&req, on_event).await
    }
}

/// Connect to the runtime IPC socket with a bounded retry on transient
/// `NotFound` (ENOENT) and `ConnectionRefused`.
///
/// The host runtime binds `rm.sock` as a side-effect of `spawn_ipc_listener`
/// in `aeqi-orchestrator/src/daemon.rs`, which runs after config load and
/// SQLite store setup. The web server in the same process can begin
/// accepting `/api/mcp` requests up to a few seconds before that bind
/// completes — every internal IPC dispatch in that window used to surface
/// "No such file or directory (os error 2)" to MCP callers.
///
/// Mirrors the CLI-side helper in `aeqi-cli/src/cmd/mcp.rs`. ~5 attempts
/// across a 2s budget — long enough to ride through the cutover window,
/// short enough to leave 8s for the actual request inside the per-call 10s
/// timeout enforced by `IpcClient::request_with_timeout`. The 30s
/// `wait_for_ipc_socket` gate in `aeqi-cli/src/cmd/start.rs` is the primary
/// guard at process startup; this retry catches the rarer steady-state
/// flap (daemon SIGKILL/restart while the web server stays up). Quest 67-152.
async fn connect_with_retry(sock_path: &Path) -> Result<UnixStream> {
    let deadline = Instant::now() + Duration::from_secs(2);
    let mut attempt = 0u32;
    loop {
        match UnixStream::connect(sock_path).await {
            Ok(stream) => return Ok(stream),
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::NotFound | std::io::ErrorKind::ConnectionRefused
                ) && Instant::now() < deadline =>
            {
                let backoff = Duration::from_millis(100 + u64::from(attempt) * 100);
                tokio::time::sleep(backoff).await;
                attempt += 1;
            }
            Err(e) => {
                return Err(e).with_context(|| {
                    format!("failed to connect to IPC socket: {}", sock_path.display())
                });
            }
        }
    }
}
