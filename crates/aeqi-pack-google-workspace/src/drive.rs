//! Google Drive tools — list_files / read_file / create_doc.
//!
//! Per-agent scoping (each agent's Drive surface is independent of the next).
//! Two scopes used in this pack:
//!
//! * `https://www.googleapis.com/auth/drive.readonly` — list + read every Drive
//!   file the user can see. `drive.list_files` and `drive.read_file` resolve
//!   against this scope.
//! * `https://www.googleapis.com/auth/drive.file` — read/write access scoped
//!   to files the agent created OR that the user explicitly shared with the
//!   agent's identity. `drive.create_doc` writes only into this surface.
//!
//! We deliberately do NOT request the wide `https://www.googleapis.com/auth/drive`
//! scope — full account access is overkill for an agent surface and triggers
//! Google's "unverified app — restricted scope" consent screen friction.
//!
//! Per memory `architecture_event_tool_output_semantics.md`: these are
//! `produces_context = true` (default) tools — file listings and contents are
//! context-bearing for the LLM.

use aeqi_core::credentials::{CredentialNeed, ScopeHint, UsableCredential};
use aeqi_core::traits::{Tool, ToolResult, ToolSpec};
use anyhow::Result;
use async_trait::async_trait;
use reqwest::{Client, StatusCode};
use serde_json::{Value, json};

use crate::api::GoogleApiError;

const PROVIDER: &str = "google";
const NAME: &str = "oauth_token";
const SCOPE_RO: &str = "https://www.googleapis.com/auth/drive.readonly";
const SCOPE_FILE: &str = "https://www.googleapis.com/auth/drive.file";
const DRIVE_BASE: &str = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE: &str = "https://www.googleapis.com/upload/drive/v3";
/// Truncation limit for `drive.read_file` — Drive can return arbitrarily large
/// payloads but the LLM context budget can't absorb a 200KB doc. Keep the head
/// 50KB; surface a `truncated` flag in `data` so the agent knows to ask for
/// the rest via export+attachment if it needs more.
const READ_FILE_MAX_BYTES: usize = 50 * 1024;

const FIELDS_LIST: &str =
    "files(id,name,mimeType,webViewLink,modifiedTime),nextPageToken";
const FIELDS_FILE: &str = "id,name,mimeType,webViewLink,modifiedTime";

fn need(scopes: Vec<&'static str>) -> CredentialNeed {
    CredentialNeed::new(PROVIDER, NAME, ScopeHint::Agent).with_scopes(scopes)
}

fn first_cred(creds: Vec<Option<UsableCredential>>) -> Option<UsableCredential> {
    creds.into_iter().next().flatten()
}

fn missing_credential() -> ToolResult {
    ToolResult::error("missing_credential: provider=google name=oauth_token (no agent-scoped Google credential found — run the bootstrap flow first)").with_data(json!({"reason_code": "missing_credential"}))
}

fn into_tool_error(err: GoogleApiError) -> ToolResult {
    let reason = err.reason_code();
    let mut data = json!({ "reason_code": reason });
    if let GoogleApiError::AuthExpired { credential_id } = &err {
        data["credential_id"] = json!(credential_id);
    }
    ToolResult::error(err.to_string()).with_data(data)
}

/// Per-agent override of the Drive base URL — set on the credential's metadata
/// (`aeqi_test_drive_base`) by the integration test harness so it can point
/// the tools at a hand-rolled mock server.
fn drive_base(cred: &UsableCredential) -> String {
    cred.metadata
        .get("aeqi_test_drive_base")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| DRIVE_BASE.to_string())
}

fn drive_upload_base(cred: &UsableCredential) -> String {
    cred.metadata
        .get("aeqi_test_drive_upload_base")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| DRIVE_UPLOAD_BASE.to_string())
}

/// Validate the credential carries every scope in `required`. Mirrors the
/// `GoogleApiClient::ensure_scopes` contract — separate copy here because this
/// module talks to a different base URL than the gmail/calendar client and
/// avoids a re-export of the scope helper.
fn ensure_scopes(cred: &UsableCredential, required: &[&str]) -> Result<(), GoogleApiError> {
    let scope_str = cred
        .metadata
        .get("scopes")
        .and_then(|v| {
            if let Some(arr) = v.as_array() {
                Some(
                    arr.iter()
                        .filter_map(|s| s.as_str())
                        .collect::<Vec<_>>()
                        .join(" "),
                )
            } else {
                v.as_str().map(str::to_string)
            }
        })
        .unwrap_or_default();
    let has: Vec<&str> = scope_str.split_whitespace().collect();
    for need in required {
        if !drive_scope_satisfied(&has, need) {
            return Err(GoogleApiError::ScopeMismatch {
                has: has.join(" "),
                needs: need.to_string(),
            });
        }
    }
    Ok(())
}

/// Drive scope hierarchy: the wide `drive` scope covers everything; otherwise
/// each scope is its own leaf. Mirrors the structure of `api::scope_satisfied`
/// but for the Drive subtree only.
fn drive_scope_satisfied(has: &[&str], required: &str) -> bool {
    if has.contains(&required) {
        return true;
    }
    let drive_full = "https://www.googleapis.com/auth/drive";
    if has.contains(&drive_full) {
        return required == SCOPE_RO || required == SCOPE_FILE || required == drive_full;
    }
    false
}

fn auth_header(cred: &UsableCredential) -> (String, String) {
    if let Some(h) = cred.headers.iter().find(|(k, _)| k == "Authorization") {
        return h.clone();
    }
    (
        "Authorization".to_string(),
        format!("Bearer {}", cred.bearer.as_deref().unwrap_or_default()),
    )
}

// ------------------------------------------------------------------------
// drive.list_files
// ------------------------------------------------------------------------

pub struct DriveListFilesTool;

#[async_trait]
impl Tool for DriveListFilesTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "drive.list_files requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "drive.list_files".into(),
            description: "Search Google Drive files visible to this agent. `query` is a Drive search expression (e.g. `name contains 'memo'`, `mimeType = 'application/vnd.google-apps.document'`); pass an empty string to list recently-modified files. Returns up to `limit` matches as `{id, name, mime_type, web_view_link, modified_at}`.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Drive search query (Google's `q` param). Empty string lists recent files." },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 100, "default": 20 }
                },
                "required": ["query"]
            }),
        }
    }

    fn name(&self) -> &str {
        "drive.list_files"
    }

    fn required_credentials(&self) -> Vec<CredentialNeed> {
        vec![need(vec![SCOPE_RO])]
    }

    async fn execute_with_credentials(
        &self,
        args: Value,
        credentials: Vec<Option<UsableCredential>>,
    ) -> Result<ToolResult> {
        let cred = match first_cred(credentials) {
            Some(c) => c,
            None => return Ok(missing_credential()),
        };
        if let Err(e) = ensure_scopes(&cred, &[SCOPE_RO]) {
            return Ok(into_tool_error(e));
        }
        let query = args.get("query").and_then(|v| v.as_str()).unwrap_or("");
        let limit = args
            .get("limit")
            .and_then(|v| v.as_u64())
            .map(|v| v.clamp(1, 100) as u32)
            .unwrap_or(20);

        let mut url = format!(
            "{}/files?pageSize={}&fields={}",
            drive_base(&cred).trim_end_matches('/'),
            limit,
            urlencoding::encode(FIELDS_LIST),
        );
        if !query.is_empty() {
            url.push_str(&format!("&q={}", urlencoding::encode(query)));
        }

        let (auth_k, auth_v) = auth_header(&cred);
        let resp = match Client::new().get(&url).header(auth_k, auth_v).send().await {
            Ok(r) => r,
            Err(e) => return Ok(into_tool_error(GoogleApiError::Transport(e.to_string()))),
        };
        let status = resp.status();
        if status == StatusCode::UNAUTHORIZED {
            return Ok(into_tool_error(GoogleApiError::AuthExpired {
                credential_id: cred.id.clone(),
            }));
        }
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Ok(into_tool_error(GoogleApiError::Http {
                status: status.as_u16(),
                body,
            }));
        }
        let body: Value = match resp.json().await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(GoogleApiError::Transport(e.to_string()))),
        };
        let items = body
            .get("files")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let mapped: Vec<Value> = items
            .iter()
            .map(|f| {
                json!({
                    "id":             f.get("id").cloned().unwrap_or(Value::Null),
                    "name":           f.get("name").cloned().unwrap_or(Value::Null),
                    "mime_type":      f.get("mimeType").cloned().unwrap_or(Value::Null),
                    "web_view_link":  f.get("webViewLink").cloned().unwrap_or(Value::Null),
                    "modified_at":    f.get("modifiedTime").cloned().unwrap_or(Value::Null),
                })
            })
            .collect();
        Ok(
            ToolResult::success(format!("found {} file(s)", mapped.len()))
                .with_data(json!({ "files": mapped })),
        )
    }
}

// ------------------------------------------------------------------------
// drive.read_file
// ------------------------------------------------------------------------

pub struct DriveReadFileTool;

#[async_trait]
impl Tool for DriveReadFileTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "drive.read_file requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "drive.read_file".into(),
            description: "Fetch the contents of a Google Drive file by id. Google-native types (Docs, Sheets, Slides) are exported as plain text via `?mimeType=text/plain`; binary types are streamed via `?alt=media`. Output is truncated to ~50KB; `data.truncated=true` signals the file was longer.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "file_id": { "type": "string", "description": "Drive file id (the `id` field from drive.list_files)" }
                },
                "required": ["file_id"]
            }),
        }
    }

    fn name(&self) -> &str {
        "drive.read_file"
    }

    fn required_credentials(&self) -> Vec<CredentialNeed> {
        vec![need(vec![SCOPE_RO])]
    }

    async fn execute_with_credentials(
        &self,
        args: Value,
        credentials: Vec<Option<UsableCredential>>,
    ) -> Result<ToolResult> {
        let cred = match first_cred(credentials) {
            Some(c) => c,
            None => return Ok(missing_credential()),
        };
        if let Err(e) = ensure_scopes(&cred, &[SCOPE_RO]) {
            return Ok(into_tool_error(e));
        }
        let file_id = args.get("file_id").and_then(|v| v.as_str()).unwrap_or("");
        if file_id.is_empty() {
            return Ok(ToolResult::error("missing 'file_id'"));
        }
        let base = drive_base(&cred);
        let base_trimmed = base.trim_end_matches('/');

        // 1. Fetch metadata to discover the mime type — chooses export vs
        //    media path. Google-native types only have `export`; binaries
        //    only have `alt=media`.
        let meta_url = format!(
            "{base_trimmed}/files/{}?fields={}",
            urlencoding::encode(file_id),
            urlencoding::encode(FIELDS_FILE),
        );
        let (auth_k, auth_v) = auth_header(&cred);
        let http = Client::new();
        let meta_resp = match http
            .get(&meta_url)
            .header(&auth_k, &auth_v)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => return Ok(into_tool_error(GoogleApiError::Transport(e.to_string()))),
        };
        let meta_status = meta_resp.status();
        if meta_status == StatusCode::UNAUTHORIZED {
            return Ok(into_tool_error(GoogleApiError::AuthExpired {
                credential_id: cred.id.clone(),
            }));
        }
        if !meta_status.is_success() {
            let body = meta_resp.text().await.unwrap_or_default();
            return Ok(into_tool_error(GoogleApiError::Http {
                status: meta_status.as_u16(),
                body,
            }));
        }
        let meta: Value = match meta_resp.json().await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(GoogleApiError::Transport(e.to_string()))),
        };
        let mime = meta
            .get("mimeType")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let name = meta
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let web_view_link = meta
            .get("webViewLink")
            .cloned()
            .unwrap_or(Value::Null);

        // 2. Fetch content. Google-native (`application/vnd.google-apps.*`)
        //    must use /export; everything else uses ?alt=media.
        let content_url = if mime.starts_with("application/vnd.google-apps.") {
            format!(
                "{base_trimmed}/files/{}/export?mimeType=text/plain",
                urlencoding::encode(file_id),
            )
        } else {
            format!(
                "{base_trimmed}/files/{}?alt=media",
                urlencoding::encode(file_id),
            )
        };
        let content_resp = match http
            .get(&content_url)
            .header(&auth_k, &auth_v)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => return Ok(into_tool_error(GoogleApiError::Transport(e.to_string()))),
        };
        let content_status = content_resp.status();
        if content_status == StatusCode::UNAUTHORIZED {
            return Ok(into_tool_error(GoogleApiError::AuthExpired {
                credential_id: cred.id.clone(),
            }));
        }
        if !content_status.is_success() {
            let body = content_resp.text().await.unwrap_or_default();
            return Ok(into_tool_error(GoogleApiError::Http {
                status: content_status.as_u16(),
                body,
            }));
        }
        let bytes = match content_resp.bytes().await {
            Ok(b) => b,
            Err(e) => return Ok(into_tool_error(GoogleApiError::Transport(e.to_string()))),
        };
        let total_bytes = bytes.len();
        let (truncated, head_bytes) = if total_bytes > READ_FILE_MAX_BYTES {
            (true, &bytes[..READ_FILE_MAX_BYTES])
        } else {
            (false, bytes.as_ref())
        };
        // Best-effort UTF-8 — non-UTF-8 binary content surfaces as a lossy
        // string + truncated flag so the agent knows to redirect to a download.
        let content = String::from_utf8_lossy(head_bytes).to_string();
        Ok(ToolResult::success(format!(
            "read {total_bytes} bytes ({mime}){}",
            if truncated { " [truncated]" } else { "" }
        ))
        .with_data(json!({
            "id":            file_id,
            "name":          name,
            "mime_type":     mime,
            "web_view_link": web_view_link,
            "content":       content,
            "truncated":     truncated,
            "total_bytes":   total_bytes,
        })))
    }
}

// ------------------------------------------------------------------------
// drive.create_doc
// ------------------------------------------------------------------------

pub struct DriveCreateDocTool;

#[async_trait]
impl Tool for DriveCreateDocTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "drive.create_doc requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "drive.create_doc".into(),
            description: "Create a new Google Doc owned by the agent. `content` is uploaded as plain text and Drive converts it to a native Doc on the way in. Returns the new doc's id and a webViewLink the agent (or user) can open in the browser.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "name":    { "type": "string", "description": "Display name for the new doc" },
                    "content": { "type": "string", "description": "Plain-text body. Markdown is preserved as plain text — use Docs styling later via the docs API if needed." }
                },
                "required": ["name", "content"]
            }),
        }
    }

    fn name(&self) -> &str {
        "drive.create_doc"
    }

    fn is_destructive(&self, _input: &Value) -> bool {
        // Side-effect on the user's Drive — surface in the tool-call review UI.
        true
    }

    fn required_credentials(&self) -> Vec<CredentialNeed> {
        vec![need(vec![SCOPE_FILE])]
    }

    async fn execute_with_credentials(
        &self,
        args: Value,
        credentials: Vec<Option<UsableCredential>>,
    ) -> Result<ToolResult> {
        let cred = match first_cred(credentials) {
            Some(c) => c,
            None => return Ok(missing_credential()),
        };
        if let Err(e) = ensure_scopes(&cred, &[SCOPE_FILE]) {
            return Ok(into_tool_error(e));
        }
        let name = args.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
        if name.is_empty() {
            return Ok(ToolResult::error("missing 'name'"));
        }

        // Drive's multipart upload: one metadata part (JSON) + one media
        // part (text/plain). Setting `mimeType=application/vnd.google-apps.document`
        // on the metadata and `text/plain` on the media tells Drive to convert
        // the body into a native Doc on ingest.
        let boundary = format!("aeqi_drive_{}", boundary_token());
        let metadata = json!({
            "name": name,
            "mimeType": "application/vnd.google-apps.document",
        });
        let body = format!(
            "--{boundary}\r\n\
             Content-Type: application/json; charset=UTF-8\r\n\r\n\
             {metadata}\r\n\
             --{boundary}\r\n\
             Content-Type: text/plain; charset=UTF-8\r\n\r\n\
             {content}\r\n\
             --{boundary}--",
            boundary = boundary,
            metadata = serde_json::to_string(&metadata).unwrap_or_default(),
        );

        let url = format!(
            "{}/files?uploadType=multipart&fields={}",
            drive_upload_base(&cred).trim_end_matches('/'),
            urlencoding::encode(FIELDS_FILE),
        );
        let (auth_k, auth_v) = auth_header(&cred);
        let resp = match Client::new()
            .post(&url)
            .header(auth_k, auth_v)
            .header(
                reqwest::header::CONTENT_TYPE,
                format!("multipart/related; boundary={boundary}"),
            )
            .body(body)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => return Ok(into_tool_error(GoogleApiError::Transport(e.to_string()))),
        };
        let status = resp.status();
        if status == StatusCode::UNAUTHORIZED {
            return Ok(into_tool_error(GoogleApiError::AuthExpired {
                credential_id: cred.id.clone(),
            }));
        }
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Ok(into_tool_error(GoogleApiError::Http {
                status: status.as_u16(),
                body,
            }));
        }
        let parsed: Value = match resp.json().await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(GoogleApiError::Transport(e.to_string()))),
        };
        let id = parsed
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let web_view_link = parsed.get("webViewLink").cloned().unwrap_or(Value::Null);
        Ok(ToolResult::success(format!("created doc id={id}")).with_data(json!({
            "id":            id,
            "web_view_link": web_view_link,
        })))
    }
}

/// Multipart boundary token. Just a timestamp — the only requirement is that
/// it doesn't appear in the body, and an aeqi-prefixed nanosecond stamp is
/// long enough to be unique across concurrent calls.
fn boundary_token() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos:032x}")
}

pub fn all_tools() -> Vec<std::sync::Arc<dyn Tool>> {
    vec![
        std::sync::Arc::new(DriveListFilesTool),
        std::sync::Arc::new(DriveReadFileTool),
        std::sync::Arc::new(DriveCreateDocTool),
    ]
}

pub const READONLY_SCOPE: &str = SCOPE_RO;
pub const FILE_SCOPE: &str = SCOPE_FILE;

#[cfg(test)]
mod tests {
    use super::*;

    fn cred_with_scopes(scopes: &[&str]) -> UsableCredential {
        UsableCredential {
            id: "cred-test".into(),
            provider: PROVIDER.into(),
            name: NAME.into(),
            headers: vec![(
                "Authorization".to_string(),
                "Bearer token-test".to_string(),
            )],
            bearer: Some("token-test".into()),
            raw: Vec::new(),
            metadata: json!({ "scopes": scopes }),
        }
    }

    #[test]
    fn ensure_scopes_accepts_exact_drive_readonly() {
        let c = cred_with_scopes(&[SCOPE_RO]);
        assert!(ensure_scopes(&c, &[SCOPE_RO]).is_ok());
    }

    #[test]
    fn ensure_scopes_rejects_when_only_file_scope_present() {
        // drive.file does NOT cover drive.readonly — they're independent leaves.
        let c = cred_with_scopes(&[SCOPE_FILE]);
        assert!(ensure_scopes(&c, &[SCOPE_RO]).is_err());
    }

    #[test]
    fn ensure_scopes_full_drive_covers_both() {
        let c = cred_with_scopes(&["https://www.googleapis.com/auth/drive"]);
        assert!(ensure_scopes(&c, &[SCOPE_RO]).is_ok());
        assert!(ensure_scopes(&c, &[SCOPE_FILE]).is_ok());
    }

    #[test]
    fn all_tools_registers_three() {
        let tools = all_tools();
        assert_eq!(tools.len(), 3);
        let names: Vec<&str> = tools.iter().map(|t| t.name()).collect();
        assert!(names.contains(&"drive.list_files"));
        assert!(names.contains(&"drive.read_file"));
        assert!(names.contains(&"drive.create_doc"));
    }

    #[test]
    fn drive_list_files_required_scope_is_readonly() {
        let needs = DriveListFilesTool.required_credentials();
        assert_eq!(needs.len(), 1);
        assert!(needs[0].oauth_scopes.contains(&SCOPE_RO));
    }

    #[test]
    fn drive_create_doc_required_scope_is_file() {
        let needs = DriveCreateDocTool.required_credentials();
        assert_eq!(needs.len(), 1);
        assert!(needs[0].oauth_scopes.contains(&SCOPE_FILE));
    }
}
