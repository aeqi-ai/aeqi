//! Ported parity tests from `hermes-agent/tests/agent/test_redact.py`.
//!
//! The contract is: every pattern hermes redacts, aeqi redacts the same way.
//! When a hermes test asserts "abc123def456 not in result", we assert the
//! same. When it asserts a non-secret string passes through unchanged, we do
//! too.

use super::*;

// ─────────────────────────── known prefixes ───────────────────────────

#[test]
fn openai_sk_key_is_masked() {
    let out = redact("Using key sk-proj-abc123def456ghi789jkl012");
    assert!(out.contains("sk-pro"), "head preserved: {out}");
    assert!(!out.contains("abc123def456"), "body masked: {out}");
    assert!(out.contains("..."), "ellipsis present: {out}");
}

#[test]
fn openrouter_sk_key_is_masked() {
    let out = redact("OPENROUTER_API_KEY=sk-or-v1-abcdefghijklmnopqrstuvwxyz1234567890");
    assert!(!out.contains("abcdefghijklmnop"), "{out}");
}

#[test]
fn github_pat_classic_is_masked() {
    let out = redact("token: ghp_abc123def456ghi789jkl");
    assert!(!out.contains("abc123def456"), "{out}");
}

#[test]
fn github_pat_fine_grained_is_masked() {
    let out = redact("github_pat_abc123def456ghi789jklmno");
    assert!(!out.contains("abc123def456"), "{out}");
}

#[test]
fn slack_token_is_masked() {
    let token = format!("xoxb-{}-{}", "0".repeat(12), "a".repeat(14));
    let out = redact(&token);
    assert!(!out.contains(&"a".repeat(14)), "{out}");
}

#[test]
fn google_api_key_is_masked() {
    let out = redact("AIzaSyB-abc123def456ghi789jklmno012345");
    assert!(!out.contains("abc123def456"), "{out}");
}

#[test]
fn perplexity_key_is_masked() {
    let out = redact("pplx-abcdef123456789012345");
    assert!(!out.contains("abcdef12345"), "{out}");
}

#[test]
fn fal_key_is_masked() {
    let out = redact("fal_abc123def456ghi789jkl");
    assert!(!out.contains("abc123def456"), "{out}");
}

#[test]
fn short_token_fully_masked() {
    let out = redact("key=sk-short1234567");
    assert!(out.contains("***"), "{out}");
}

// ─────────────────────────── ENV assignments ───────────────────────────

#[test]
fn env_export_api_key_is_masked() {
    let out = redact("export OPENAI_API_KEY=sk-proj-abc123def456ghi789jkl012");
    assert!(out.contains("OPENAI_API_KEY="), "{out}");
    assert!(!out.contains("abc123def456"), "{out}");
}

#[test]
fn env_quoted_value_is_masked() {
    let out = redact("MY_SECRET_TOKEN=\"supersecretvalue123456789\"");
    assert!(out.contains("MY_SECRET_TOKEN="), "{out}");
    assert!(!out.contains("supersecretvalue"), "{out}");
}

#[test]
fn env_non_secret_passes_through() {
    let text = "HOME=/home/user";
    let out = redact(text);
    assert_eq!(out, text);
}

#[test]
fn env_path_passes_through() {
    let text = "PATH=/usr/local/bin:/usr/bin";
    let out = redact(text);
    assert_eq!(out, text);
}

#[test]
fn lowercase_python_token_passes_through() {
    let text = "before_tokens = response.usage.prompt_tokens";
    let out = redact(text);
    assert_eq!(out, text);
}

#[test]
fn lowercase_python_api_key_passes_through() {
    let text = "api_key = config.get('api_key')";
    let out = redact(text);
    assert_eq!(out, text);
}

// ─────────────────────────── JSON fields ───────────────────────────

#[test]
fn json_api_key_is_masked() {
    let out = redact(r#"{"apiKey": "supersecretvalue123456789"}"#);
    assert!(!out.contains("supersecretvalue"), "{out}");
}

#[test]
fn json_token_is_masked() {
    let out = redact(r#"{"token": "abcdefghijklmnopqrstuvwxyz"}"#);
    assert!(!out.contains("abcdefghijklmnop"), "{out}");
}

#[test]
fn json_non_secret_passes_through() {
    let text = r#"{"name": "alice", "role": "admin"}"#;
    let out = redact(text);
    assert_eq!(out, text);
}

// ─────────────────────────── auth headers ───────────────────────────

#[test]
fn bearer_token_is_masked() {
    let out = redact("Authorization: Bearer eyJabcdefghijklmnopqrstuvwxyz0123");
    assert!(!out.contains("eyJabcdefghijklmnop"), "{out}");
    assert!(out.contains("Authorization: Bearer "), "{out}");
}

#[test]
fn bearer_case_insensitive() {
    let out = redact("authorization: bearer abcdefghijklmnopqrstuvwxyz123");
    assert!(!out.contains("abcdefghijklmnop"), "{out}");
}

// ─────────────────────────── Telegram tokens ───────────────────────────

#[test]
fn telegram_bot_token_is_masked() {
    let out = redact("bot1234567890:ABC-DEF1234ghIkl-zyx57W2v1u123ew11");
    assert!(!out.contains("ABC-DEF1234"), "{out}");
    assert!(out.contains("1234567890:***"), "{out}");
}

#[test]
fn telegram_raw_token_is_masked() {
    let out = redact("1234567890:ABC-DEF1234ghIkl-zyx57W2v1u123ew11");
    assert!(!out.contains("ABC-DEF1234"), "{out}");
}

// ─────────────────────────── passthrough ───────────────────────────

#[test]
fn empty_string_unchanged() {
    let out = redact("");
    assert_eq!(out, "");
}

#[test]
fn normal_text_unchanged() {
    let text = "User logged in successfully.";
    let out = redact(text);
    assert_eq!(out, text);
}

#[test]
fn url_without_secrets_unchanged() {
    let text = "https://example.com/api/v1/users";
    let out = redact(text);
    assert_eq!(out, text);
}

// ─────────────────────────── JWT tokens ───────────────────────────

#[test]
fn full_3part_jwt_is_masked() {
    let jwt =
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    let out = redact(jwt);
    assert!(!out.contains("eyJhbGciOiJIUzI1NiJ9"), "{out}");
}

#[test]
fn jwt_preserves_surrounding_text() {
    let out = redact(
        "token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
    );
    assert!(out.starts_with("token: "), "{out}");
    assert!(!out.contains("eyJhbGciOiJIUzI1NiJ9"), "{out}");
}

#[test]
fn short_eyj_not_matched() {
    let text = "eyJshort";
    let out = redact(text);
    assert_eq!(out, text);
}

// ─────────────────────────── URL query params ───────────────────────────

#[test]
fn oauth_callback_code_is_masked() {
    let out = redact("https://example.com/cb?code=ABC123xyz789&state=abc");
    assert!(!out.contains("code=ABC123xyz789"), "{out}");
    assert!(out.contains("code=***"), "{out}");
    assert!(out.contains("state=abc"), "non-sensitive preserved: {out}");
}

#[test]
fn access_token_query_is_masked() {
    let out = redact("https://api.example.com/me?access_token=abc123xyz789");
    assert!(out.contains("access_token=***"), "{out}");
}

#[test]
fn api_key_query_is_masked() {
    let out = redact("https://api.example.com/v1?api_key=opaque-token-value");
    assert!(out.contains("api_key=***"), "{out}");
    assert!(!out.contains("opaque-token-value"), "{out}");
}

#[test]
fn case_insensitive_param_names() {
    let out = redact("https://api.example.com/v1?Access_Token=abc123");
    assert!(out.contains("Access_Token=***"), "{out}");
}

#[test]
fn substring_match_does_not_trigger() {
    // `tokenized` must NOT be matched as `token`.
    let text = "https://api.example.com/v1?tokenized=plain&id=123";
    let out = redact(text);
    assert_eq!(out, text);
}

// ─────────────────────────── URL userinfo ───────────────────────────

#[test]
fn http_userinfo_is_masked() {
    let out = redact("https://user:p4ssw0rd@api.example.com/v1/foo");
    assert!(!out.contains("p4ssw0rd"), "{out}");
    assert!(out.contains("user:***@"), "{out}");
}

#[test]
fn websocket_userinfo_is_masked() {
    let out = redact("wss://user:secret@example.com/ws");
    assert!(!out.contains(":secret@"), "{out}");
}

// ─────────────────────────── DB connection strings ───────────────────────────

#[test]
fn postgres_password_is_masked() {
    let out = redact("postgres://alice:hunter2@db.example.com:5432/mydb");
    assert!(!out.contains("hunter2"), "{out}");
    assert!(out.contains("alice:***@"), "{out}");
}

#[test]
fn mysql_password_is_masked() {
    let out = redact("mysql://root:RootP@ss@127.0.0.1:3306/app");
    // The first `:` after user splits user from password; the `@ss` after the
    // password is preserved as part of the password match.
    assert!(!out.contains("RootP"), "{out}");
}

// ─────────────────────────── private keys ───────────────────────────

#[test]
fn pem_private_key_is_masked() {
    let pem = "-----BEGIN RSA PRIVATE KEY-----\nABCDEFG\n-----END RSA PRIVATE KEY-----";
    let out = redact(pem);
    assert!(!out.contains("ABCDEFG"), "{out}");
    assert!(out.contains("[REDACTED PRIVATE KEY]"), "{out}");
}

// ─────────────────────────── Discord mentions ───────────────────────────

#[test]
fn discord_mention_is_masked() {
    let out = redact("<@123456789012345678> said hi");
    assert!(!out.contains("123456789012345678"), "{out}");
    assert!(out.contains("<@***>"), "{out}");
}

#[test]
fn discord_nickname_mention_is_masked() {
    let out = redact("<@!123456789012345678>");
    assert!(out.contains("<@!***>"), "{out}");
}

// ─────────────────────────── opt-out ───────────────────────────

#[test]
fn redact_forced_ignores_env_opt_out() {
    // This test does not depend on the env var — apply_passes is always called.
    let out = redact_forced("sk-proj-abc123def456ghi789jkl012");
    assert!(!out.contains("abc123def456"), "{out}");
}

// ─────────────────────────── tracing integration ───────────────────────────

#[test]
fn make_writer_redacts_tracing_event() {
    use std::io::Write;
    use std::sync::{Arc, Mutex};
    use tracing_subscriber::fmt::MakeWriter;

    // A MakeWriter that captures bytes into a shared buffer.
    #[derive(Clone)]
    struct CaptureWriter(Arc<Mutex<Vec<u8>>>);
    impl Write for CaptureWriter {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    impl<'a> MakeWriter<'a> for CaptureWriter {
        type Writer = CaptureWriter;
        fn make_writer(&'a self) -> Self::Writer {
            self.clone()
        }
    }

    let buf = Arc::new(Mutex::new(Vec::<u8>::new()));
    let capture = CaptureWriter(buf.clone());
    let redacting = crate::RedactingMakeWriter::new(capture);

    let subscriber = tracing_subscriber::fmt()
        .with_writer(redacting)
        .without_time()
        .with_ansi(false)
        .finish();

    tracing::subscriber::with_default(subscriber, || {
        tracing::info!(
            api_key = "sk-proj-abc123def456ghi789jkl012",
            "calling upstream"
        );
    });

    let captured = String::from_utf8(buf.lock().unwrap().clone()).unwrap();
    assert!(
        !captured.contains("abc123def456"),
        "raw secret leaked through tracing layer: {captured}"
    );
    assert!(
        captured.contains("calling upstream"),
        "log line content preserved: {captured}"
    );
}
