//! Regex-based secret redaction for logs, tool output, and error strings.
//!
//! Ported from `hermes-agent/agent/redact.py` (nearai/ironclaw#2529 family of
//! patterns). The goal is parity, not novelty: every prefix and pattern here
//! should match the hermes behaviour so an operator can move between the two
//! systems without learning a different redaction surface.
//!
//! Short tokens (< 18 chars) are fully masked. Longer tokens preserve the
//! first 6 and last 4 characters for debuggability.
//!
//! # Catch-all integration
//!
//! Wire [`RedactingMakeWriter`] into the `tracing-subscriber` writer to mask
//! every formatted event line. The default subscriber init in `aeqi-cli` calls
//! [`RedactingMakeWriter::stdout()`] / [`RedactingMakeWriter::stderr()`].
//!
//! # Targeted integration
//!
//! Call [`redact`] at known sensitive sites — e.g. before stuffing an upstream
//! HTTP response body into an `InferenceError` variant — so the secret never
//! enters the error chain in the first place.

use regex::Regex;
use std::sync::LazyLock;

/// Environment variable controlling whether redaction is active. Default ON.
///
/// Snapshot at first call so a runtime mutation cannot disable redaction
/// mid-session. Mirrors `HERMES_REDACT_SECRETS` semantics.
pub const ENV_VAR: &str = "AEQI_REDACT_SECRETS";

static REDACT_ENABLED: LazyLock<bool> = LazyLock::new(|| match std::env::var(ENV_VAR) {
    Ok(v) => matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"),
    Err(_) => true,
});

/// Returns true if redaction is currently active (env-controlled, snapshotted).
pub fn is_enabled() -> bool {
    *REDACT_ENABLED
}

/// Logs a one-line warning when redaction has been opted out. Call once at
/// startup so operators see the downgrade.
pub fn log_status() {
    if !is_enabled() {
        tracing::warn!(
            target: "aeqi_redact",
            env = ENV_VAR,
            "secret redaction is DISABLED — logs may contain raw API keys, tokens, and credentials"
        );
    }
}

// ─────────────────────────── pattern set ───────────────────────────

/// Mask a single token preserving 6 prefix + 4 suffix chars when ≥ 18 chars.
fn mask_token(token: &str) -> String {
    if token.is_empty() {
        return "***".into();
    }
    if token.chars().count() < 18 {
        return "***".into();
    }
    let bytes = token.as_bytes();
    // Safe: ASCII-only API key alphabet, so byte slicing is grapheme-safe in
    // practice. Fall back to char-based slicing for the rare non-ASCII case.
    if token.is_ascii() {
        let head = &bytes[..6];
        let tail = &bytes[bytes.len() - 4..];
        format!(
            "{}...{}",
            std::str::from_utf8(head).unwrap_or("***"),
            std::str::from_utf8(tail).unwrap_or("***")
        )
    } else {
        let head: String = token.chars().take(6).collect();
        let tail: String = token
            .chars()
            .rev()
            .take(4)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        format!("{head}...{tail}")
    }
}

// Known vendor prefix alternation. Order is irrelevant for correctness but
// `sk_[A-Za-z0-9_]{10,}` is intentionally last among the `sk_*` family so
// `sk_live_*` / `sk_test_*` win when both could match.
static PREFIX_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r"(?:^|[^A-Za-z0-9_\-])(",
        // OpenAI / OpenRouter / Anthropic (incl. sk-ant-*)
        r"sk-[A-Za-z0-9_\-]{10,}",
        // GitHub family
        r"|ghp_[A-Za-z0-9]{10,}",
        r"|github_pat_[A-Za-z0-9_]{10,}",
        r"|gho_[A-Za-z0-9]{10,}",
        r"|ghu_[A-Za-z0-9]{10,}",
        r"|ghs_[A-Za-z0-9]{10,}",
        r"|ghr_[A-Za-z0-9]{10,}",
        // Slack
        r"|xox[baprs]-[A-Za-z0-9\-]{10,}",
        // Google
        r"|AIza[A-Za-z0-9_\-]{30,}",
        // Perplexity
        r"|pplx-[A-Za-z0-9]{10,}",
        // Fal / Firecrawl / BrowserBase
        r"|fal_[A-Za-z0-9_\-]{10,}",
        r"|fc-[A-Za-z0-9]{10,}",
        r"|bb_live_[A-Za-z0-9_\-]{10,}",
        // Codex / AWS / Stripe / SendGrid / HF / Replicate / npm / PyPI / DO
        r"|gAAAA[A-Za-z0-9_=\-]{20,}",
        r"|AKIA[A-Z0-9]{16}",
        r"|sk_live_[A-Za-z0-9]{10,}",
        r"|sk_test_[A-Za-z0-9]{10,}",
        r"|rk_live_[A-Za-z0-9]{10,}",
        r"|SG\.[A-Za-z0-9_\-]{10,}",
        r"|hf_[A-Za-z0-9]{10,}",
        r"|r8_[A-Za-z0-9]{10,}",
        r"|npm_[A-Za-z0-9]{10,}",
        r"|pypi-[A-Za-z0-9_\-]{10,}",
        r"|dop_v1_[A-Za-z0-9]{10,}",
        r"|doo_v1_[A-Za-z0-9]{10,}",
        // Misc agentic SaaS
        r"|am_[A-Za-z0-9_\-]{10,}",
        r"|tvly-[A-Za-z0-9]{10,}",
        r"|exa_[A-Za-z0-9]{10,}",
        r"|gsk_[A-Za-z0-9]{10,}",
        r"|syt_[A-Za-z0-9]{10,}",
        r"|retaindb_[A-Za-z0-9]{10,}",
        r"|hsk-[A-Za-z0-9]{10,}",
        r"|mem0_[A-Za-z0-9]{10,}",
        r"|brv_[A-Za-z0-9]{10,}",
        // ElevenLabs (sk_ underscore, must come LAST in sk_* family)
        r"|sk_[A-Za-z0-9_]{10,}",
        r")(?:[^A-Za-z0-9_\-]|$)",
    ))
    .expect("PREFIX_RE compiles")
});

// ENV-style assignments: KEY=value where KEY name carries a secret-y word.
//
// rust regex has no backreferences, so we enumerate the three quote styles as
// separate alternatives. Exactly one of capture groups 2/3/4 will be populated
// per match — see `replace_env_assign` for the picker.
static ENV_ASSIGN_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"([A-Z0-9_]{0,50}(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)[A-Z0-9_]{0,50})\s*=\s*(?:"([^"]+)"|'([^']+)'|(\S+))"#,
    )
    .expect("ENV_ASSIGN_RE compiles")
});

// JSON-style fields: "apiKey": "value" — case-insensitive on the key name.
static JSON_FIELD_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)("(?:api_?key|token|secret|password|access_token|refresh_token|auth_token|bearer|secret_value|raw_secret|secret_input|key_material)")\s*:\s*"([^"]+)""#,
    )
    .expect("JSON_FIELD_RE compiles")
});

// Authorization: Bearer <token>
static AUTH_HEADER_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(Authorization:\s*Bearer\s+)(\S+)").expect("AUTH_HEADER_RE compiles")
});

// Telegram bot token: bot<digits>:<token>  or  <digits>:<token>
static TELEGRAM_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(bot)?(\d{8,}):([-A-Za-z0-9_]{30,})").expect("TELEGRAM_RE compiles")
});

// PEM-encoded private keys.
static PRIVATE_KEY_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----")
        .expect("PRIVATE_KEY_RE compiles")
});

// Database connection strings: protocol://user:PASSWORD@host
static DB_CONNSTR_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp)://[^:\s]+:)([^@\s]+)(@)",
    )
    .expect("DB_CONNSTR_RE compiles")
});

// JWT-shaped tokens: header.payload[.signature], always start with "eyJ".
static JWT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"eyJ[A-Za-z0-9_\-]{10,}(?:\.[A-Za-z0-9_=\-]{4,}){0,2}").expect("JWT_RE compiles")
});

// Discord mention: <@123456789012345678> or <@!...>
static DISCORD_MENTION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<@(!?)\d{17,20}>").expect("DISCORD_MENTION_RE compiles"));

// URL with query string: scheme://authority/path?query[#fragment]
static URL_WITH_QUERY_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(https?|wss?|ftp)://([^\s/?#]+)([^\s?#]*)\?([^\s#]+)(#\S*)?")
        .expect("URL_WITH_QUERY_RE compiles")
});

// URL with userinfo: scheme://user:password@host for non-DB schemes.
static URL_USERINFO_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(https?|wss?|ftp)://([^/\s:@]+):([^/\s@]+)@").expect("URL_USERINFO_RE compiles")
});

const SENSITIVE_QUERY_PARAMS: &[&str] = &[
    "access_token",
    "refresh_token",
    "id_token",
    "token",
    "api_key",
    "apikey",
    "client_secret",
    "password",
    "auth",
    "jwt",
    "session",
    "secret",
    "key",
    "code",
    "signature",
    "x-amz-signature",
];

fn is_sensitive_query_param(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    SENSITIVE_QUERY_PARAMS.iter().any(|p| *p == lower)
}

fn redact_query_string(query: &str) -> String {
    let mut out = String::with_capacity(query.len());
    for (i, pair) in query.split('&').enumerate() {
        if i > 0 {
            out.push('&');
        }
        if let Some(eq) = pair.find('=') {
            let (key, rest) = pair.split_at(eq);
            if is_sensitive_query_param(key) {
                out.push_str(key);
                out.push_str("=***");
            } else {
                out.push_str(pair);
            }
            // suppress unused warning
            let _ = rest;
        } else {
            out.push_str(pair);
        }
    }
    out
}

// ─────────────────────────── public API ───────────────────────────

/// Apply every redaction pass to `text`. Safe to call on any string; non-matching
/// input is returned unchanged (modulo intermediate allocation). When the
/// `AEQI_REDACT_SECRETS` env var is set to a falsy value, this returns the input
/// verbatim.
///
/// Use [`redact_forced`] at safety boundaries that must never emit raw secrets
/// even when the operator has opted out.
pub fn redact(text: &str) -> String {
    if !is_enabled() {
        return text.to_owned();
    }
    apply_passes(text)
}

/// Like [`redact`] but ignores the env opt-out. Use at safety boundaries
/// (audit logs, support-bundle uploads, anything leaving the host).
pub fn redact_forced(text: &str) -> String {
    apply_passes(text)
}

fn apply_passes(text: &str) -> String {
    if text.is_empty() {
        return String::new();
    }

    // 1. Known vendor prefixes.
    let stage1 = PREFIX_RE
        .replace_all(text, |caps: &regex::Captures<'_>| {
            // Reproduce the lookaround behaviour: the regex matches an optional
            // boundary char on each side. Preserve those boundary chars.
            let full = caps.get(0).unwrap().as_str();
            let token = caps.get(1).unwrap().as_str();
            let masked = mask_token(token);
            full.replacen(token, &masked, 1)
        })
        .into_owned();

    // 2. ENV assignments. Exactly one of capture groups 2 (double-quoted),
    //    3 (single-quoted), 4 (unquoted) is populated per match.
    let stage2 = ENV_ASSIGN_RE
        .replace_all(&stage1, |caps: &regex::Captures<'_>| {
            let name = caps.get(1).unwrap().as_str();
            let (quote, value) = if let Some(m) = caps.get(2) {
                ("\"", m.as_str())
            } else if let Some(m) = caps.get(3) {
                ("'", m.as_str())
            } else {
                ("", caps.get(4).unwrap().as_str())
            };
            format!("{name}={quote}{}{quote}", mask_token(value))
        })
        .into_owned();

    // 3. JSON fields.
    let stage3 = JSON_FIELD_RE
        .replace_all(&stage2, |caps: &regex::Captures<'_>| {
            let key = caps.get(1).unwrap().as_str();
            let value = caps.get(2).unwrap().as_str();
            format!(r#"{key}: "{}""#, mask_token(value))
        })
        .into_owned();

    // 4. Authorization headers.
    let stage4 = AUTH_HEADER_RE
        .replace_all(&stage3, |caps: &regex::Captures<'_>| {
            let prefix = caps.get(1).unwrap().as_str();
            let token = caps.get(2).unwrap().as_str();
            format!("{prefix}{}", mask_token(token))
        })
        .into_owned();

    // 5. Telegram bot tokens.
    let stage5 = TELEGRAM_RE
        .replace_all(&stage4, |caps: &regex::Captures<'_>| {
            let prefix = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let digits = caps.get(2).unwrap().as_str();
            format!("{prefix}{digits}:***")
        })
        .into_owned();

    // 6. Private key blocks.
    let stage6 = PRIVATE_KEY_RE
        .replace_all(&stage5, "[REDACTED PRIVATE KEY]")
        .into_owned();

    // 7. DB connection string passwords.
    let stage7 = DB_CONNSTR_RE
        .replace_all(&stage6, |caps: &regex::Captures<'_>| {
            let head = caps.get(1).unwrap().as_str();
            let at = caps.get(3).unwrap().as_str();
            format!("{head}***{at}")
        })
        .into_owned();

    // 8. JWT tokens.
    let stage8 = JWT_RE
        .replace_all(&stage7, |caps: &regex::Captures<'_>| {
            mask_token(caps.get(0).unwrap().as_str())
        })
        .into_owned();

    // 9. URL userinfo for HTTP/WS/FTP schemes.
    let stage9 = URL_USERINFO_RE
        .replace_all(&stage8, |caps: &regex::Captures<'_>| {
            let scheme = caps.get(1).unwrap().as_str();
            let user = caps.get(2).unwrap().as_str();
            format!("{scheme}://{user}:***@")
        })
        .into_owned();

    // 10. URL query params containing opaque tokens.
    let stage10 = URL_WITH_QUERY_RE
        .replace_all(&stage9, |caps: &regex::Captures<'_>| {
            let scheme = caps.get(1).unwrap().as_str();
            let authority = caps.get(2).unwrap().as_str();
            let path = caps.get(3).map(|m| m.as_str()).unwrap_or("");
            let query = redact_query_string(caps.get(4).unwrap().as_str());
            let fragment = caps.get(5).map(|m| m.as_str()).unwrap_or("");
            format!("{scheme}://{authority}{path}?{query}{fragment}")
        })
        .into_owned();

    // 11. Discord mentions.
    DISCORD_MENTION_RE
        .replace_all(&stage10, |caps: &regex::Captures<'_>| {
            let bang = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            format!("<@{bang}***>")
        })
        .into_owned()
}

// ─────────────────────────── tracing integration ───────────────────────────

/// Writer wrapper that runs every formatted log line through [`redact`] before
/// emission. Implements [`tracing_subscriber::fmt::MakeWriter`] so it slots
/// directly into the subscriber builder via `.with_writer(...)`.
///
/// Note: tracing-subscriber's `fmt` layer writes one formatted event per
/// `write_all` call, so byte-level redaction over a single write is safe — no
/// risk of splitting a token across writes.
pub struct RedactingMakeWriter<M> {
    inner: M,
}

impl<M> RedactingMakeWriter<M> {
    pub fn new(inner: M) -> Self {
        Self { inner }
    }
}

impl RedactingMakeWriter<fn() -> std::io::Stdout> {
    /// Convenience: redacting stdout writer.
    pub fn stdout() -> RedactingMakeWriter<fn() -> std::io::Stdout> {
        RedactingMakeWriter::new(std::io::stdout as fn() -> std::io::Stdout)
    }
}

impl RedactingMakeWriter<fn() -> std::io::Stderr> {
    /// Convenience: redacting stderr writer.
    pub fn stderr() -> RedactingMakeWriter<fn() -> std::io::Stderr> {
        RedactingMakeWriter::new(std::io::stderr as fn() -> std::io::Stderr)
    }
}

impl<'a, M> tracing_subscriber::fmt::MakeWriter<'a> for RedactingMakeWriter<M>
where
    M: tracing_subscriber::fmt::MakeWriter<'a>,
{
    type Writer = RedactingWriter<M::Writer>;

    fn make_writer(&'a self) -> Self::Writer {
        RedactingWriter {
            inner: self.inner.make_writer(),
        }
    }
}

pub struct RedactingWriter<W> {
    inner: W,
}

impl<W: std::io::Write> std::io::Write for RedactingWriter<W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        // Try to interpret the buffer as UTF-8. If it isn't, pass through —
        // tracing-subscriber's fmt layer always writes UTF-8.
        match std::str::from_utf8(buf) {
            Ok(s) => {
                let redacted = redact(s);
                self.inner.write_all(redacted.as_bytes())?;
                // Honour the Write contract: report bytes consumed from `buf`,
                // not bytes emitted to `inner`.
                Ok(buf.len())
            }
            Err(_) => self.inner.write(buf),
        }
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

#[cfg(test)]
mod tests;
