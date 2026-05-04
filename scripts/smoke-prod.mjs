#!/usr/bin/env node
/**
 * Production smoke test for app.aeqi.ai. Runs critical paths and alerts
 * via Resend if any fail. Designed to run on a cron — every 5 minutes
 * during launch crunch, every 15 minutes once stable.
 *
 * Checks (each is a single HTTP call, ~hundred ms):
 *   1. /api/health → 200 (platform alive)
 *   2. https://app.aeqi.ai/ → 200, contains 'index-XXX.js' hash
 *   3. /api/auth/invite/check {code: bogus} → 200 with valid:false
 *   4. /api/auth/me with admin JWT → 200 with id matching admin
 *   5. /api/admin/overview with admin JWT → 200 with users array
 *
 * Failure path: collect each red check, send a single Resend email to
 * the founder. Idempotent — repeating a failure within 30 min is
 * deduped via a dotfile lock.
 *
 * Env:
 *   AEQI_WEB_SECRET    — JWT signing secret (required, from /etc/aeqi/secrets.env)
 *   RESEND_API_KEY     — Resend API key for alerting (required for failures)
 *   ALERT_TO           — destination email (default eqaq131@gmail.com)
 *   ALERT_FROM         — From header (default 'aeqi smoke <hello@aeqi.ai>')
 *   AEQI_ADMIN_USER_ID — admin user UUID (default bbbd909d-02ab-4ea6-9da2-98d10d4aeba8)
 *   AEQI_ADMIN_EMAIL   — admin email (default eqaq131@gmail.com)
 *
 * Exit: 0 on all green, 1 on any failure (cron sees the failure code
 * AND the alert email arrives; both signals exist for redundancy).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = "https://app.aeqi.ai";
const ADMIN_USER_ID = process.env.AEQI_ADMIN_USER_ID ?? "bbbd909d-02ab-4ea6-9da2-98d10d4aeba8";
const ADMIN_EMAIL = process.env.AEQI_ADMIN_EMAIL ?? "eqaq131@gmail.com";
const ALERT_TO = process.env.ALERT_TO ?? "eqaq131@gmail.com";
const ALERT_FROM = process.env.ALERT_FROM ?? "aeqi smoke <hello@aeqi.ai>";
const DEDUP_FILE = path.join(os.tmpdir(), "aeqi-smoke-last-alert");
const DEDUP_WINDOW_MS = 30 * 60 * 1000;

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function mintJwt(secret, userId, email, ttl = 600) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      sub: userId,
      user_id: userId,
      email,
      iat: now,
      exp: now + ttl,
    }),
  );
  const sig = b64url(crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

async function check(name, fn) {
  const t0 = Date.now();
  try {
    const result = await fn();
    const elapsed = Date.now() - t0;
    if (result.ok) {
      console.log(`[OK] ${name} (${elapsed}ms)`);
      return { name, ok: true, elapsed };
    } else {
      console.error(`[FAIL] ${name} (${elapsed}ms): ${result.detail}`);
      return { name, ok: false, elapsed, detail: result.detail };
    }
  } catch (e) {
    const elapsed = Date.now() - t0;
    const detail = e instanceof Error ? e.message : String(e);
    console.error(`[FAIL] ${name} (${elapsed}ms): ${detail}`);
    return { name, ok: false, elapsed, detail };
  }
}

async function alert(failures) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("RESEND_API_KEY missing — failures logged but no email sent");
    return;
  }

  // Dedup: skip if we alerted within the window
  try {
    if (fs.existsSync(DEDUP_FILE)) {
      const last = parseInt(fs.readFileSync(DEDUP_FILE, "utf8"), 10);
      if (!Number.isNaN(last) && Date.now() - last < DEDUP_WINDOW_MS) {
        console.log("[DEDUP] alert suppressed (last alert within 30min)");
        return;
      }
    }
  } catch {
    // ignore dedup file errors
  }

  const subject = `aeqi smoke FAILED — ${failures.length} check${failures.length > 1 ? "s" : ""} red`;
  const body = `<div style="font-family:Inter,system-ui,sans-serif;color:#0a0a0b">
<p>aeqi production smoke detected failures.</p>
<ul>
${failures.map((f) => `<li><strong>${f.name}</strong>: ${f.detail || "no detail"}</li>`).join("\n")}
</ul>
<p style="color:#666;font-size:13px">Run at ${new Date().toISOString()} · base ${BASE}</p>
</div>`;

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: ALERT_FROM, to: [ALERT_TO], subject, html: body }),
    });
    if (resp.ok) {
      console.log(`[ALERT] sent to ${ALERT_TO}`);
      try {
        fs.writeFileSync(DEDUP_FILE, String(Date.now()), "utf8");
      } catch {
        // ignore
      }
    } else {
      console.error(`[ALERT] Resend ${resp.status}: ${await resp.text()}`);
    }
  } catch (e) {
    console.error(`[ALERT] send failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function main() {
  const secret = process.env.AEQI_WEB_SECRET;
  if (!secret) {
    console.error("AEQI_WEB_SECRET missing");
    process.exit(2);
  }

  const jwt = mintJwt(secret, ADMIN_USER_ID, ADMIN_EMAIL);

  const results = [];
  results.push(
    await check("health", async () => {
      const r = await fetch(`${BASE}/api/health`);
      return r.ok ? { ok: true } : { ok: false, detail: `status ${r.status}` };
    }),
  );
  results.push(
    await check("landing-html", async () => {
      const r = await fetch(`${BASE}/`);
      if (!r.ok) return { ok: false, detail: `status ${r.status}` };
      const text = await r.text();
      if (!/index-[A-Za-z0-9_-]+\.js/.test(text)) {
        return { ok: false, detail: "no hashed JS asset reference" };
      }
      return { ok: true };
    }),
  );
  results.push(
    await check("invite-check-public", async () => {
      const r = await fetch(`${BASE}/api/auth/invite/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "smoketest-bogus" }),
      });
      if (!r.ok) return { ok: false, detail: `status ${r.status}` };
      const j = await r.json();
      if (j.valid !== false) return { ok: false, detail: `expected valid:false, got ${j.valid}` };
      return { ok: true };
    }),
  );
  results.push(
    await check("authed-me", async () => {
      const r = await fetch(`${BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (!r.ok) return { ok: false, detail: `status ${r.status}` };
      const j = await r.json();
      if (j.id !== ADMIN_USER_ID) return { ok: false, detail: `id mismatch: ${j.id}` };
      return { ok: true };
    }),
  );
  results.push(
    await check("admin-overview", async () => {
      const r = await fetch(`${BASE}/api/admin/overview`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (!r.ok) return { ok: false, detail: `status ${r.status}` };
      const j = await r.json();
      if (!Array.isArray(j.users)) return { ok: false, detail: "no users array" };
      return { ok: true };
    }),
  );

  const failures = results.filter((r) => !r.ok);
  if (failures.length > 0) {
    await alert(failures);
    process.exit(1);
  }
  console.log(`[GREEN] ${results.length} checks passed`);
}

main().catch((e) => {
  console.error("smoke crashed:", e);
  process.exit(2);
});
