//! One-off operator tool: verify and fix Google Workspace DNS records on aeqi.ai.
//!
//! Reads PORKBUN_API_KEY + PORKBUN_SECRET_KEY from the local credentials substrate,
//! fetches the current record set on aeqi.ai, diffs it against what Workspace
//! needs, and (optionally) adds the missing records via Porkbun's `dns/create`.
//!
//! Usage:
//!   cargo run -p aeqi-tools --bin porkbun_aeqi_dns -- check         # diff only
//!   cargo run -p aeqi-tools --bin porkbun_aeqi_dns -- apply         # diff + add missing

use aeqi_core::credentials::store::read_global_legacy_blob_sync;
use anyhow::{bail, Context, Result};
use reqwest::Client;
use serde_json::{json, Value};
use std::path::PathBuf;

const DOMAIN: &str = "aeqi.ai";
const BASE_URL: &str = "https://api.porkbun.com/api/json/v3";

#[derive(Debug, Clone)]
struct Required {
    record_type: &'static str,
    name: &'static str,
    content: &'static str,
    prio: Option<&'static str>,
    note: &'static str,
}

fn required_records() -> Vec<Required> {
    vec![
        Required {
            record_type: "MX",
            name: "",
            content: "smtp.google.com.",
            prio: Some("1"),
            note: "Google Workspace single-record MX",
        },
        Required {
            record_type: "TXT",
            name: "",
            content: "v=spf1 include:_spf.google.com ~all",
            prio: None,
            note: "SPF — Workspace senders",
        },
        // _dmarc is intentionally excluded: DMARC must be a single TXT record at
        // the _dmarc label; an existing record (p=none) is already in place. Use
        // a separate update step to strengthen it (set rua / move to p=quarantine).
    ]
}

fn auth_body(api_key: &str, secret_key: &str) -> Value {
    json!({ "apikey": api_key, "secretapikey": secret_key })
}

async fn post(client: &Client, path: &str, body: Value) -> Result<Value> {
    let url = format!("{BASE_URL}{path}");
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .with_context(|| format!("POST {url}"))?;
    let status = resp.status();
    let v: Value = resp
        .json()
        .await
        .with_context(|| format!("decode JSON from {url}"))?;
    if !status.is_success() {
        bail!("Porkbun {status}: {v}");
    }
    if v.get("status").and_then(|s| s.as_str()) != Some("SUCCESS") {
        bail!("Porkbun rejected: {v}");
    }
    Ok(v)
}

async fn list_records(client: &Client, api: &str, sec: &str) -> Result<Vec<Value>> {
    let body = auth_body(api, sec);
    let resp = post(client, &format!("/dns/retrieve/{DOMAIN}"), body).await?;
    Ok(resp
        .get("records")
        .and_then(|r| r.as_array())
        .cloned()
        .unwrap_or_default())
}

fn record_matches(existing: &Value, want: &Required) -> bool {
    let r_type = existing.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let r_name = existing.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let r_content = existing
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if r_type != want.record_type {
        return false;
    }
    let want_fqdn = if want.name.is_empty() {
        DOMAIN.to_string()
    } else {
        format!("{}.{}", want.name, DOMAIN)
    };
    if r_name != want_fqdn {
        return false;
    }
    // Porkbun stores TXT content with quotes stripped, MX content w/o trailing dot.
    let normalized_existing = r_content.trim_end_matches('.').trim();
    let normalized_want = want.content.trim_end_matches('.').trim();
    normalized_existing == normalized_want
}

async fn add_record(
    client: &Client,
    api: &str,
    sec: &str,
    want: &Required,
) -> Result<()> {
    let mut body = auth_body(api, sec);
    let obj = body.as_object_mut().unwrap();
    obj.insert("type".to_string(), json!(want.record_type));
    obj.insert("content".to_string(), json!(want.content));
    obj.insert("ttl".to_string(), json!("600"));
    if !want.name.is_empty() {
        obj.insert("name".to_string(), json!(want.name));
    }
    if let Some(p) = want.prio {
        obj.insert("prio".to_string(), json!(p));
    }
    let resp = post(client, &format!("/dns/create/{DOMAIN}"), body).await?;
    println!("    + created (porkbun id {})", resp.get("id").map(|v| v.to_string()).unwrap_or_default());
    Ok(())
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    let mode = std::env::args().nth(1).unwrap_or_else(|| "check".to_string());
    let do_apply = match mode.as_str() {
        "check" => false,
        "apply" => true,
        other => bail!("unknown mode {other:?} — use `check` or `apply`"),
    };

    let data_dir: PathBuf = std::env::var("AEQI_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            dirs::home_dir().unwrap_or_default().join(".aeqi")
        });

    let api_key = read_global_legacy_blob_sync(&data_dir, "PORKBUN_API_KEY")?
        .context("PORKBUN_API_KEY missing from credentials substrate")?;
    let secret_key = read_global_legacy_blob_sync(&data_dir, "PORKBUN_SECRET_KEY")?
        .context("PORKBUN_SECRET_KEY missing from credentials substrate")?;
    println!("loaded Porkbun creds from {}", data_dir.display());

    let client = Client::new();
    let existing = list_records(&client, &api_key, &secret_key).await?;
    println!("aeqi.ai currently has {} record(s)", existing.len());

    println!();
    println!("relevant existing records:");
    for r in &existing {
        let t = r.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let n = r.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let c = r.get("content").and_then(|v| v.as_str()).unwrap_or("");
        let p = r.get("prio").and_then(|v| v.as_str()).unwrap_or("");
        if t == "MX" || t == "TXT" {
            println!("  {t:6} {n:40} prio={p:3} -> {c}");
        }
    }

    println!();
    println!("required Workspace records:");
    let req = required_records();
    let mut missing = Vec::new();
    for w in &req {
        let present = existing.iter().any(|r| record_matches(r, w));
        let mark = if present { "OK    " } else { "MISSING" };
        let prio = w.prio.unwrap_or("-");
        let display_name = if w.name.is_empty() {
            format!("@.{DOMAIN}")
        } else {
            format!("{}.{}", w.name, DOMAIN)
        };
        println!(
            "  [{mark}] {t:5} {name:32} prio={prio:3} -> {content}    ({note})",
            t = w.record_type,
            name = display_name,
            content = w.content,
            note = w.note
        );
        if !present {
            missing.push(w.clone());
        }
    }

    if missing.is_empty() {
        println!();
        println!("nothing to do — all Workspace records present.");
        return Ok(());
    }

    println!();
    if !do_apply {
        println!("(check mode) {} record(s) missing — re-run with `apply` to add", missing.len());
        return Ok(());
    }

    println!("applying {} missing record(s):", missing.len());
    for w in &missing {
        let display_name = if w.name.is_empty() {
            format!("@.{DOMAIN}")
        } else {
            format!("{}.{}", w.name, DOMAIN)
        };
        println!("  {} {} -> {}", w.record_type, display_name, w.content);
        add_record(&client, &api_key, &secret_key, w).await?;
    }
    println!("done.");
    Ok(())
}
