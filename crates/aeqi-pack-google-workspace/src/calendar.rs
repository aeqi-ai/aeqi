//! Google Calendar tools — list_events / create_event / update_event /
//! delete_event.
//!
//! Per-agent scoping (each agent's calendar is independent of the next).
//! `list_events` only needs `calendar.readonly`; create / update / delete
//! need the full `calendar` scope.

use aeqi_core::credentials::{CredentialNeed, ScopeHint, UsableCredential};
use aeqi_core::traits::{Tool, ToolResult, ToolSpec};
use anyhow::Result;
use async_trait::async_trait;
use serde_json::{Value, json};

use crate::api::{CALENDAR_BASE, GoogleApiClient, GoogleApiError};

const PROVIDER: &str = "google";
const NAME: &str = "oauth_token";
const SCOPE_RO: &str = "https://www.googleapis.com/auth/calendar.readonly";
const SCOPE_RW: &str = "https://www.googleapis.com/auth/calendar";

fn need(scopes: Vec<&'static str>) -> CredentialNeed {
    CredentialNeed::new(PROVIDER, NAME, ScopeHint::Agent).with_scopes(scopes)
}

fn first_cred(creds: Vec<Option<UsableCredential>>) -> Option<UsableCredential> {
    creds.into_iter().next().flatten()
}

fn missing_credential() -> ToolResult {
    ToolResult::error("missing_credential: provider=google name=oauth_token (no agent-scoped Google credential found — run the bootstrap flow first)").with_data(json!({"reason_code": "missing_credential"}))
}

fn build_client(cred: &UsableCredential) -> GoogleApiClient<'_> {
    let base_override = cred
        .metadata
        .get("aeqi_test_base")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let mut c = GoogleApiClient::new(cred);
    if let Some(b) = base_override {
        c = c.with_base(b.clone(), b);
    }
    c
}

fn into_tool_error(err: GoogleApiError) -> ToolResult {
    let reason = err.reason_code();
    let mut data = json!({ "reason_code": reason });
    if let GoogleApiError::AuthExpired { credential_id } = &err {
        data["credential_id"] = json!(credential_id);
    }
    ToolResult::error(err.to_string()).with_data(data)
}

fn calendar_id_or_primary(args: &Value) -> String {
    args.get("calendar_id")
        .and_then(|v| v.as_str())
        .unwrap_or("primary")
        .to_string()
}

// ------------------------------------------------------------------------
// calendar.list_events
// ------------------------------------------------------------------------

pub struct CalendarListEventsTool;

#[async_trait]
impl Tool for CalendarListEventsTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "calendar.list_events requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "calendar.list_events".into(),
            description: "List events on a Google Calendar within an RFC3339 time window. Defaults to the agent's primary calendar.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "time_min":    { "type": "string", "description": "RFC3339 start (inclusive)" },
                    "time_max":    { "type": "string", "description": "RFC3339 end (exclusive)" },
                    "calendar_id": { "type": "string", "description": "Calendar id, default 'primary'" }
                },
                "required": ["time_min", "time_max"]
            }),
        }
    }

    fn name(&self) -> &str {
        "calendar.list_events"
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
        let client = build_client(&cred);
        if let Err(e) = client.ensure_scopes(&[SCOPE_RO]) {
            return Ok(into_tool_error(e));
        }
        let cal = calendar_id_or_primary(&args);
        let time_min = args.get("time_min").and_then(|v| v.as_str()).unwrap_or("");
        let time_max = args.get("time_max").and_then(|v| v.as_str()).unwrap_or("");
        if time_min.is_empty() || time_max.is_empty() {
            return Ok(ToolResult::error("missing 'time_min' or 'time_max'"));
        }
        let url = format!(
            "{}/calendars/{}/events?timeMin={}&timeMax={}&singleEvents=true&orderBy=startTime",
            client.calendar_base().trim_end_matches('/'),
            urlencoding::encode(&cal),
            urlencoding::encode(time_min),
            urlencoding::encode(time_max),
        );
        let resp: Value = match client.get(url).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let events = resp
            .get("items")
            .cloned()
            .unwrap_or(Value::Array(Vec::new()));
        Ok(
            ToolResult::success(serde_json::to_string(&events).unwrap_or_default())
                .with_data(json!({ "events": events })),
        )
    }
}

// ------------------------------------------------------------------------
// calendar.create_event
// ------------------------------------------------------------------------

pub struct CalendarCreateEventTool;

#[async_trait]
impl Tool for CalendarCreateEventTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "calendar.create_event requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "calendar.create_event".into(),
            description: "Create a calendar event. Set `conferencing_meet=true` to attach a Google Meet link via conferenceData.createRequest. Returns the new event id and (when conferencing) the Meet join link.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "title":        { "type": "string" },
                    "start":        { "type": "string", "description": "RFC3339 start (e.g. 2026-04-25T15:00:00-07:00)" },
                    "end":          { "type": "string", "description": "RFC3339 end" },
                    "attendees":    { "type": "array", "items": { "type": "string" } },
                    "description":  { "type": "string" },
                    "location":     { "type": "string" },
                    "conferencing_meet": { "type": "boolean", "description": "Attach a Google Meet conference" },
                    "calendar_id":  { "type": "string", "description": "Default 'primary'" }
                },
                "required": ["title", "start", "end"]
            }),
        }
    }

    fn name(&self) -> &str {
        "calendar.create_event"
    }

    fn is_destructive(&self, _input: &Value) -> bool {
        true
    }

    fn required_credentials(&self) -> Vec<CredentialNeed> {
        vec![need(vec![SCOPE_RW])]
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
        let client = build_client(&cred);
        if let Err(e) = client.ensure_scopes(&[SCOPE_RW]) {
            return Ok(into_tool_error(e));
        }
        let cal = calendar_id_or_primary(&args);
        let title = args.get("title").and_then(|v| v.as_str()).unwrap_or("");
        let start = args.get("start").and_then(|v| v.as_str()).unwrap_or("");
        let end = args.get("end").and_then(|v| v.as_str()).unwrap_or("");
        if title.is_empty() || start.is_empty() || end.is_empty() {
            return Ok(ToolResult::error("missing 'title', 'start', or 'end'"));
        }
        let mut body = json!({
            "summary": title,
            "start": { "dateTime": start },
            "end":   { "dateTime": end },
        });
        if let Some(desc) = args.get("description").and_then(|v| v.as_str())
            && !desc.is_empty()
            && let Some(obj) = body.as_object_mut()
        {
            obj.insert("description".into(), Value::String(desc.into()));
        }
        if let Some(loc) = args.get("location").and_then(|v| v.as_str())
            && !loc.is_empty()
            && let Some(obj) = body.as_object_mut()
        {
            obj.insert("location".into(), Value::String(loc.into()));
        }
        if let Some(arr) = args.get("attendees").and_then(|v| v.as_array()) {
            let attendees: Vec<Value> = arr
                .iter()
                .filter_map(|v| v.as_str())
                .map(|s| json!({ "email": s }))
                .collect();
            if let Some(obj) = body.as_object_mut() {
                obj.insert("attendees".into(), Value::Array(attendees));
            }
        }
        let want_meet = args
            .get("conferencing_meet")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let mut url = format!(
            "{}/calendars/{}/events",
            client.calendar_base().trim_end_matches('/'),
            urlencoding::encode(&cal),
        );
        if want_meet {
            url.push_str("?conferenceDataVersion=1");
            if let Some(obj) = body.as_object_mut() {
                obj.insert(
                    "conferenceData".into(),
                    json!({
                        "createRequest": {
                            "requestId": format!("aeqi-{}", uuid_v4_lite()),
                            "conferenceSolutionKey": { "type": "hangoutsMeet" }
                        }
                    }),
                );
            }
        }
        let resp: Value = match client.post_json(url, body).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let event_id = resp
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let meet_link = extract_meet_link(&resp);
        Ok(ToolResult::success(format!(
            "created event id={event_id}{}",
            meet_link
                .as_ref()
                .map(|l| format!(" meet={l}"))
                .unwrap_or_default()
        ))
        .with_data(json!({
            "event_id": event_id,
            "meet_link": meet_link,
            "html_link": resp.get("htmlLink").cloned().unwrap_or(Value::Null),
        })))
    }
}

/// Pull the Meet join URI out of a Calendar event response. Google nests it
/// under `conferenceData.entryPoints[].uri` where `entryPointType == "video"`.
pub fn extract_meet_link(event: &Value) -> Option<String> {
    let entries = event
        .get("conferenceData")
        .and_then(|c| c.get("entryPoints"))
        .and_then(|v| v.as_array())?;
    for ep in entries {
        if ep
            .get("entryPointType")
            .and_then(|v| v.as_str())
            .map(|s| s == "video")
            .unwrap_or(false)
            && let Some(uri) = ep.get("uri").and_then(|v| v.as_str())
        {
            return Some(uri.to_string());
        }
    }
    None
}

/// Tiny UUID-v4-shaped string. We don't pull the `uuid` crate into this
/// module — `requestId` only needs to be unique per createRequest call.
fn uuid_v4_lite() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos:032x}")
}

// ------------------------------------------------------------------------
// calendar.update_event
// ------------------------------------------------------------------------

pub struct CalendarUpdateEventTool;

#[async_trait]
impl Tool for CalendarUpdateEventTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "calendar.update_event requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "calendar.update_event".into(),
            description: "Patch fields on an existing calendar event. Only the fields you pass are sent — title/description/location/start/end/attendees. Uses PATCH semantics so unspecified fields are preserved.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "event_id":    { "type": "string" },
                    "title":       { "type": "string" },
                    "description": { "type": "string" },
                    "location":    { "type": "string" },
                    "start":       { "type": "string" },
                    "end":         { "type": "string" },
                    "attendees":   { "type": "array", "items": { "type": "string" } },
                    "calendar_id": { "type": "string" }
                },
                "required": ["event_id"]
            }),
        }
    }

    fn name(&self) -> &str {
        "calendar.update_event"
    }

    fn is_destructive(&self, _input: &Value) -> bool {
        true
    }

    fn required_credentials(&self) -> Vec<CredentialNeed> {
        vec![need(vec![SCOPE_RW])]
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
        let client = build_client(&cred);
        if let Err(e) = client.ensure_scopes(&[SCOPE_RW]) {
            return Ok(into_tool_error(e));
        }
        let cal = calendar_id_or_primary(&args);
        let event_id = args.get("event_id").and_then(|v| v.as_str()).unwrap_or("");
        if event_id.is_empty() {
            return Ok(ToolResult::error("missing 'event_id'"));
        }
        let mut body = json!({});
        let obj = body.as_object_mut().unwrap();
        if let Some(t) = args.get("title").and_then(|v| v.as_str()) {
            obj.insert("summary".into(), Value::String(t.into()));
        }
        if let Some(d) = args.get("description").and_then(|v| v.as_str()) {
            obj.insert("description".into(), Value::String(d.into()));
        }
        if let Some(l) = args.get("location").and_then(|v| v.as_str()) {
            obj.insert("location".into(), Value::String(l.into()));
        }
        if let Some(s) = args.get("start").and_then(|v| v.as_str()) {
            obj.insert("start".into(), json!({ "dateTime": s }));
        }
        if let Some(e) = args.get("end").and_then(|v| v.as_str()) {
            obj.insert("end".into(), json!({ "dateTime": e }));
        }
        if let Some(arr) = args.get("attendees").and_then(|v| v.as_array()) {
            let attendees: Vec<Value> = arr
                .iter()
                .filter_map(|v| v.as_str())
                .map(|s| json!({ "email": s }))
                .collect();
            obj.insert("attendees".into(), Value::Array(attendees));
        }
        if obj.is_empty() {
            return Ok(ToolResult::error(
                "no fields to update — pass at least one of title/description/location/start/end/attendees",
            ));
        }
        let url = format!(
            "{}/calendars/{}/events/{}",
            client.calendar_base().trim_end_matches('/'),
            urlencoding::encode(&cal),
            urlencoding::encode(event_id),
        );
        let resp: Value = match client.patch_json(url, body).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        Ok(ToolResult::success(format!("updated event id={event_id}"))
            .with_data(json!({ "event": resp })))
    }
}

// ------------------------------------------------------------------------
// calendar.delete_event
// ------------------------------------------------------------------------

pub struct CalendarDeleteEventTool;

#[async_trait]
impl Tool for CalendarDeleteEventTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "calendar.delete_event requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "calendar.delete_event".into(),
            description: "Delete a calendar event by id. Irreversible.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "event_id":    { "type": "string" },
                    "calendar_id": { "type": "string" }
                },
                "required": ["event_id"]
            }),
        }
    }

    fn name(&self) -> &str {
        "calendar.delete_event"
    }

    fn is_destructive(&self, _input: &Value) -> bool {
        true
    }

    fn required_credentials(&self) -> Vec<CredentialNeed> {
        vec![need(vec![SCOPE_RW])]
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
        let client = build_client(&cred);
        if let Err(e) = client.ensure_scopes(&[SCOPE_RW]) {
            return Ok(into_tool_error(e));
        }
        let cal = calendar_id_or_primary(&args);
        let event_id = args.get("event_id").and_then(|v| v.as_str()).unwrap_or("");
        if event_id.is_empty() {
            return Ok(ToolResult::error("missing 'event_id'"));
        }
        let url = format!(
            "{}/calendars/{}/events/{}",
            client.calendar_base().trim_end_matches('/'),
            urlencoding::encode(&cal),
            urlencoding::encode(event_id),
        );
        match client.delete_no_body(url).await {
            Ok(()) => Ok(ToolResult::success(format!("deleted event id={event_id}"))
                .with_data(json!({ "event_id": event_id, "deleted": true }))),
            Err(e) => Ok(into_tool_error(e)),
        }
    }
}

// ------------------------------------------------------------------------
// calendar.find_busy
// ------------------------------------------------------------------------
//
// Hits Google's `/freeBusy` endpoint and returns the busy intervals per
// calendar id (typically email) so the LLM can compute candidate slots.
// Per-email errors are surfaced separately — Google reports
// `{ errors: [{ domain, reason }, ...] }` on calendars the agent can't
// see, which is a recoverable per-attendee fact rather than a tool-level
// failure.

pub struct CalendarFindBusyTool;

#[async_trait]
impl Tool for CalendarFindBusyTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "calendar.find_busy requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "calendar.find_busy".into(),
            description: "Query Google Calendar /freeBusy for one or more calendar ids (typically email addresses). Returns the busy intervals per email plus any per-email errors (e.g. calendar not shared with the agent).".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "emails":   { "type": "array", "items": { "type": "string" }, "description": "Calendar ids — usually email addresses" },
                    "time_min": { "type": "string", "description": "RFC3339 start of the search window" },
                    "time_max": { "type": "string", "description": "RFC3339 end of the search window" }
                },
                "required": ["emails", "time_min", "time_max"]
            }),
        }
    }

    fn name(&self) -> &str {
        "calendar.find_busy"
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
        let client = build_client(&cred);
        if let Err(e) = client.ensure_scopes(&[SCOPE_RO]) {
            return Ok(into_tool_error(e));
        }
        let time_min = args.get("time_min").and_then(|v| v.as_str()).unwrap_or("");
        let time_max = args.get("time_max").and_then(|v| v.as_str()).unwrap_or("");
        if time_min.is_empty() || time_max.is_empty() {
            return Ok(ToolResult::error("missing 'time_min' or 'time_max'"));
        }
        let emails: Vec<String> = match args.get("emails").and_then(|v| v.as_array()) {
            Some(arr) => arr
                .iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect(),
            None => {
                return Ok(ToolResult::error(
                    "missing 'emails' (must be a string array)",
                ));
            }
        };
        if emails.is_empty() {
            return Ok(ToolResult::error("'emails' is empty"));
        }
        let items: Vec<Value> = emails.iter().map(|e| json!({ "id": e })).collect();
        let body = json!({
            "timeMin": time_min,
            "timeMax": time_max,
            "items":   items,
        });
        let url = format!("{}/freeBusy", client.calendar_base().trim_end_matches('/'),);
        let resp: Value = match client.post_json(url, body).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let mut busy_per_email = serde_json::Map::new();
        let mut errors_per_email = serde_json::Map::new();
        if let Some(cals) = resp.get("calendars").and_then(|v| v.as_object()) {
            for (email, cal) in cals {
                let busy = cal.get("busy").cloned().unwrap_or(Value::Array(Vec::new()));
                busy_per_email.insert(email.clone(), busy);
                if let Some(errs) = cal.get("errors").and_then(|v| v.as_array()) {
                    let reasons: Vec<Value> = errs
                        .iter()
                        .filter_map(|e| {
                            e.get("reason")
                                .and_then(|v| v.as_str())
                                .map(|s| Value::String(s.into()))
                        })
                        .collect();
                    if !reasons.is_empty() {
                        errors_per_email.insert(email.clone(), Value::Array(reasons));
                    }
                }
            }
        }
        Ok(ToolResult::success(format!(
            "free/busy for {} calendar(s); {} with errors",
            busy_per_email.len(),
            errors_per_email.len(),
        ))
        .with_data(json!({
            "busy_per_email":   Value::Object(busy_per_email),
            "errors_per_email": Value::Object(errors_per_email),
        })))
    }
}

// ------------------------------------------------------------------------
// calendar.propose_slots
// ------------------------------------------------------------------------
//
// Pure function — no API call, no credential. Walks the search window in
// 15-minute increments, drops candidates that fall outside working
// hours/days (in the target timezone) or overlap any busy interval for
// any provided email, returns the first `count` survivors.

pub struct CalendarProposeSlotsTool;

#[derive(Clone, Copy, Debug)]
struct Interval {
    start: chrono::DateTime<chrono::Utc>,
    end: chrono::DateTime<chrono::Utc>,
}

fn parse_rfc3339(s: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|dt| dt.with_timezone(&chrono::Utc))
}

fn collect_busy_intervals(busy_per_email: &Value) -> Vec<Interval> {
    let mut out = Vec::new();
    let Some(obj) = busy_per_email.as_object() else {
        return out;
    };
    for (_email, intervals) in obj {
        let Some(arr) = intervals.as_array() else {
            continue;
        };
        for it in arr {
            let start = it
                .get("start")
                .and_then(|v| v.as_str())
                .and_then(parse_rfc3339);
            let end = it
                .get("end")
                .and_then(|v| v.as_str())
                .and_then(parse_rfc3339);
            if let (Some(s), Some(e)) = (start, end)
                && e > s
            {
                out.push(Interval { start: s, end: e });
            }
        }
    }
    out
}

/// Returns true if [start, end] overlaps any busy interval. Half-open
/// semantics: a candidate ending exactly when a busy block starts (or
/// starting exactly when a busy block ends) does NOT overlap.
fn overlaps_any(
    start: chrono::DateTime<chrono::Utc>,
    end: chrono::DateTime<chrono::Utc>,
    busy: &[Interval],
) -> bool {
    busy.iter().any(|b| start < b.end && b.start < end)
}

/// Snap a UTC datetime up to the next 15-minute boundary (00/15/30/45).
fn snap_up_15min(dt: chrono::DateTime<chrono::Utc>) -> chrono::DateTime<chrono::Utc> {
    use chrono::Timelike;
    let minute = dt.minute();
    let rem = minute % 15;
    if rem == 0 && dt.second() == 0 && dt.nanosecond() == 0 {
        return dt;
    }
    let add = 15 - rem;
    let base = dt
        .with_second(0)
        .and_then(|d| d.with_nanosecond(0))
        .unwrap_or(dt);
    base + chrono::Duration::minutes(add as i64)
}

/// Inputs for [`compute_slots`]. Bundled so the call site stays readable
/// and clippy's `too_many_arguments` lint doesn't fire.
#[derive(Clone, Debug)]
pub struct ProposeSlotsRequest<'a> {
    pub busy_per_email: &'a Value,
    pub time_min: chrono::DateTime<chrono::Utc>,
    pub time_max: chrono::DateTime<chrono::Utc>,
    pub duration_minutes: u32,
    pub working_hours_start: u8,
    pub working_hours_end: u8,
    pub working_days: &'a [u8],
    pub count: u32,
    pub tz: chrono_tz::Tz,
}

/// Compute candidate slots. Pure — used by the tool and by unit tests.
pub fn compute_slots(
    req: &ProposeSlotsRequest<'_>,
) -> Vec<(chrono::DateTime<chrono::Utc>, chrono::DateTime<chrono::Utc>)> {
    use chrono::{Datelike, Timelike};
    let busy = collect_busy_intervals(req.busy_per_email);
    let duration = chrono::Duration::minutes(req.duration_minutes as i64);
    let mut out = Vec::new();
    if req.duration_minutes == 0
        || req.working_hours_end <= req.working_hours_start
        || req.working_hours_end > 24
        || req.working_days.is_empty()
    {
        return out;
    }
    let mut t = snap_up_15min(req.time_min);
    while t + duration <= req.time_max && (out.len() as u32) < req.count {
        let local = t.with_timezone(&req.tz);
        // weekday: chrono's Weekday::num_days_from_sunday() returns 0=Sun..6=Sat
        let wd = local.weekday().num_days_from_sunday() as u8;
        if !req.working_days.contains(&wd) {
            t += chrono::Duration::minutes(15);
            continue;
        }
        // Working-hours check: candidate must start at or after
        // working_hours_start and END at or before working_hours_end on
        // the SAME local day.
        let local_end = (t + duration).with_timezone(&req.tz);
        let h_start = local.hour() as u16 * 60 + local.minute() as u16;
        let h_end = local_end.hour() as u16 * 60 + local_end.minute() as u16;
        let wh_start = req.working_hours_start as u16 * 60;
        let wh_end = req.working_hours_end as u16 * 60;
        let crosses_midnight = local.date_naive() != local_end.date_naive();
        // Allow ending at exactly midnight when working_hours_end == 24.
        let same_day = !crosses_midnight || (h_end == 0 && req.working_hours_end == 24);
        let h_end_effective = if crosses_midnight && h_end == 0 {
            24 * 60
        } else {
            h_end
        };
        if !same_day || h_start < wh_start || h_end_effective > wh_end {
            t += chrono::Duration::minutes(15);
            continue;
        }
        if overlaps_any(t, t + duration, &busy) {
            t += chrono::Duration::minutes(15);
            continue;
        }
        out.push((t, t + duration));
        t += chrono::Duration::minutes(15);
    }
    out
}

#[async_trait]
impl Tool for CalendarProposeSlotsTool {
    async fn execute(&self, args: Value) -> Result<ToolResult> {
        let time_min_str = args.get("time_min").and_then(|v| v.as_str()).unwrap_or("");
        let time_max_str = args.get("time_max").and_then(|v| v.as_str()).unwrap_or("");
        let time_min = match parse_rfc3339(time_min_str) {
            Some(t) => t,
            None => {
                return Ok(ToolResult::error(
                    "missing or invalid 'time_min' (must be RFC3339)",
                ));
            }
        };
        let time_max = match parse_rfc3339(time_max_str) {
            Some(t) => t,
            None => {
                return Ok(ToolResult::error(
                    "missing or invalid 'time_max' (must be RFC3339)",
                ));
            }
        };
        if time_max <= time_min {
            return Ok(ToolResult::error("'time_max' must be after 'time_min'"));
        }
        let duration_minutes = args
            .get("duration_minutes")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32;
        if duration_minutes == 0 {
            return Ok(ToolResult::error("missing or zero 'duration_minutes'"));
        }
        let working_hours_start = args
            .get("working_hours_start")
            .and_then(|v| v.as_u64())
            .map(|v| v.min(24) as u8)
            .unwrap_or(9);
        let working_hours_end = args
            .get("working_hours_end")
            .and_then(|v| v.as_u64())
            .map(|v| v.min(24) as u8)
            .unwrap_or(18);
        let working_days: Vec<u8> = args
            .get("working_days")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_u64())
                    .filter(|d| *d <= 6)
                    .map(|d| d as u8)
                    .collect()
            })
            .unwrap_or_else(|| vec![1, 2, 3, 4, 5]);
        let count = args
            .get("count")
            .and_then(|v| v.as_u64())
            .map(|v| v.min(u32::MAX as u64) as u32)
            .unwrap_or(3);
        let tz_name = args
            .get("timezone")
            .and_then(|v| v.as_str())
            .unwrap_or("UTC");
        let tz: chrono_tz::Tz = match tz_name.parse() {
            Ok(t) => t,
            Err(_) => {
                return Ok(ToolResult::error(format!(
                    "invalid IANA timezone: {tz_name}"
                )));
            }
        };
        let busy_per_email = args
            .get("busy_per_email")
            .cloned()
            .unwrap_or(Value::Object(serde_json::Map::new()));
        let slots = compute_slots(&ProposeSlotsRequest {
            busy_per_email: &busy_per_email,
            time_min,
            time_max,
            duration_minutes,
            working_hours_start,
            working_hours_end,
            working_days: &working_days,
            count,
            tz,
        });
        let slot_values: Vec<Value> = slots
            .iter()
            .map(|(s, e)| {
                json!({
                    "start": s.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
                    "end":   e.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
                })
            })
            .collect();
        Ok(
            ToolResult::success(format!("{} candidate slot(s)", slot_values.len()))
                .with_data(json!({ "slots": slot_values })),
        )
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "calendar.propose_slots".into(),
            description: "Pure function — given busy intervals per email (output of calendar.find_busy), propose meeting-slot candidates inside [time_min, time_max] that fit the duration, working hours, working days, and skip every busy block. Returns up to `count` slots; empty array if none.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "busy_per_email": {
                        "type": "object",
                        "description": "{ \"email\": [{\"start\": ISO8601, \"end\": ISO8601}, ...] }",
                        "additionalProperties": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "start": { "type": "string" },
                                    "end":   { "type": "string" }
                                }
                            }
                        }
                    },
                    "time_min":            { "type": "string", "description": "RFC3339 start of search window" },
                    "time_max":            { "type": "string", "description": "RFC3339 end of search window" },
                    "duration_minutes":    { "type": "integer", "minimum": 1 },
                    "working_hours_start": { "type": "integer", "minimum": 0, "maximum": 24, "default": 9 },
                    "working_hours_end":   { "type": "integer", "minimum": 0, "maximum": 24, "default": 18 },
                    "working_days":        { "type": "array",   "items": { "type": "integer", "minimum": 0, "maximum": 6 }, "default": [1,2,3,4,5], "description": "0=Sun..6=Sat" },
                    "count":               { "type": "integer", "minimum": 1, "default": 3 },
                    "timezone":            { "type": "string",  "default": "UTC", "description": "IANA timezone, e.g. 'Europe/Berlin'" }
                },
                "required": ["time_min", "time_max", "duration_minutes"]
            }),
        }
    }

    fn name(&self) -> &str {
        "calendar.propose_slots"
    }

    fn required_credentials(&self) -> Vec<CredentialNeed> {
        Vec::new()
    }
}

pub fn all_tools() -> Vec<std::sync::Arc<dyn Tool>> {
    vec![
        std::sync::Arc::new(CalendarListEventsTool),
        std::sync::Arc::new(CalendarCreateEventTool),
        std::sync::Arc::new(CalendarUpdateEventTool),
        std::sync::Arc::new(CalendarDeleteEventTool),
        std::sync::Arc::new(CalendarFindBusyTool),
        std::sync::Arc::new(CalendarProposeSlotsTool),
    ]
}

pub const READONLY_SCOPE: &str = SCOPE_RO;
pub const FULL_SCOPE: &str = SCOPE_RW;
pub const CALENDAR_API_BASE: &str = CALENDAR_BASE;

#[cfg(test)]
mod propose_slots_tests {
    use super::*;
    use chrono::TimeZone;
    use serde_json::json;

    fn utc(
        year: i32,
        month: u32,
        day: u32,
        hour: u32,
        minute: u32,
    ) -> chrono::DateTime<chrono::Utc> {
        chrono::Utc
            .with_ymd_and_hms(year, month, day, hour, minute, 0)
            .unwrap()
    }

    fn req<'a>(
        busy: &'a Value,
        time_min: chrono::DateTime<chrono::Utc>,
        time_max: chrono::DateTime<chrono::Utc>,
        duration_minutes: u32,
        working_days: &'a [u8],
        count: u32,
    ) -> ProposeSlotsRequest<'a> {
        ProposeSlotsRequest {
            busy_per_email: busy,
            time_min,
            time_max,
            duration_minutes,
            working_hours_start: 9,
            working_hours_end: 18,
            working_days,
            count,
            tz: chrono_tz::UTC,
        }
    }

    #[test]
    fn empty_busy_returns_first_count_slots_in_working_hours() {
        // Mon 2026-05-04 spans 09:00..18:00 → with 60-min duration, slots at
        // 09:00, 09:15, 09:30, ... ; we ask for 3.
        let busy = json!({});
        let r = req(
            &busy,
            utc(2026, 5, 4, 9, 0),
            utc(2026, 5, 4, 18, 0),
            60,
            &[1, 2, 3, 4, 5],
            3,
        );
        let slots = compute_slots(&r);
        assert_eq!(slots.len(), 3);
        assert_eq!(slots[0].0, utc(2026, 5, 4, 9, 0));
        assert_eq!(slots[0].1, utc(2026, 5, 4, 10, 0));
        assert_eq!(slots[1].0, utc(2026, 5, 4, 9, 15));
        assert_eq!(slots[2].0, utc(2026, 5, 4, 9, 30));
    }

    #[test]
    fn busy_interval_skips_overlapping_candidates() {
        // alice busy 09:00..10:00. First clean 60-min slot starts at 10:00.
        let busy = json!({
            "alice@example.com": [
                { "start": "2026-05-04T09:00:00Z", "end": "2026-05-04T10:00:00Z" }
            ]
        });
        let r = req(
            &busy,
            utc(2026, 5, 4, 9, 0),
            utc(2026, 5, 4, 18, 0),
            60,
            &[1, 2, 3, 4, 5],
            1,
        );
        let slots = compute_slots(&r);
        assert_eq!(slots.len(), 1);
        assert_eq!(slots[0].0, utc(2026, 5, 4, 10, 0));
    }

    #[test]
    fn multiple_emails_only_fully_free_slots_returned() {
        // alice 09:00..11:00, bob 11:00..12:00 → first free slot 12:00..13:00.
        let busy = json!({
            "alice@example.com": [
                { "start": "2026-05-04T09:00:00Z", "end": "2026-05-04T11:00:00Z" }
            ],
            "bob@example.com": [
                { "start": "2026-05-04T11:00:00Z", "end": "2026-05-04T12:00:00Z" }
            ]
        });
        let r = req(
            &busy,
            utc(2026, 5, 4, 9, 0),
            utc(2026, 5, 4, 18, 0),
            60,
            &[1, 2, 3, 4, 5],
            1,
        );
        let slots = compute_slots(&r);
        assert_eq!(slots.len(), 1);
        assert_eq!(slots[0].0, utc(2026, 5, 4, 12, 0));
        assert_eq!(slots[0].1, utc(2026, 5, 4, 13, 0));
    }

    #[test]
    fn weekend_skipped_when_workdays_are_mon_fri() {
        // Sat 2026-05-02 09:00..Mon 2026-05-04 18:00. With Mon-Fri only, all
        // Saturday and Sunday slots are skipped; first slot is Mon 09:00.
        let busy = json!({});
        let r = req(
            &busy,
            utc(2026, 5, 2, 9, 0), // Saturday
            utc(2026, 5, 4, 18, 0),
            60,
            &[1, 2, 3, 4, 5],
            1,
        );
        let slots = compute_slots(&r);
        assert_eq!(slots.len(), 1);
        assert_eq!(slots[0].0, utc(2026, 5, 4, 9, 0));
    }

    #[test]
    fn timezone_working_hours_apply_in_target_tz_not_utc() {
        // Working hours 9-17 in America/New_York (UTC-4 on 2026-05-04 — DST).
        // 09:00 NY = 13:00 UTC, 17:00 NY = 21:00 UTC.
        // Search window 09:00..21:00 UTC, duration 60 min, count 1.
        // 09:00 UTC = 05:00 NY → outside working hours → skipped.
        // First valid slot: 13:00 UTC = 09:00 NY.
        let busy = json!({});
        let r = ProposeSlotsRequest {
            busy_per_email: &busy,
            time_min: utc(2026, 5, 4, 9, 0),
            time_max: utc(2026, 5, 4, 21, 0),
            duration_minutes: 60,
            working_hours_start: 9,
            working_hours_end: 17,
            working_days: &[1, 2, 3, 4, 5],
            count: 1,
            tz: chrono_tz::America::New_York,
        };
        let slots = compute_slots(&r);
        assert_eq!(slots.len(), 1);
        assert_eq!(slots[0].0, utc(2026, 5, 4, 13, 0)); // 09:00 NY
    }

    #[test]
    fn no_slots_when_window_is_entirely_busy() {
        let busy = json!({
            "alice@example.com": [
                { "start": "2026-05-04T09:00:00Z", "end": "2026-05-04T18:00:00Z" }
            ]
        });
        let r = req(
            &busy,
            utc(2026, 5, 4, 9, 0),
            utc(2026, 5, 4, 18, 0),
            60,
            &[1, 2, 3, 4, 5],
            3,
        );
        let slots = compute_slots(&r);
        assert!(slots.is_empty());
    }

    #[test]
    fn snap_up_15min_aligns_to_quarter_hours() {
        assert_eq!(snap_up_15min(utc(2026, 5, 4, 9, 0)), utc(2026, 5, 4, 9, 0));
        assert_eq!(snap_up_15min(utc(2026, 5, 4, 9, 1)), utc(2026, 5, 4, 9, 15));
        assert_eq!(
            snap_up_15min(utc(2026, 5, 4, 9, 14)),
            utc(2026, 5, 4, 9, 15)
        );
        assert_eq!(
            snap_up_15min(utc(2026, 5, 4, 9, 16)),
            utc(2026, 5, 4, 9, 30)
        );
        assert_eq!(
            snap_up_15min(utc(2026, 5, 4, 9, 59)),
            utc(2026, 5, 4, 10, 0)
        );
    }
}
