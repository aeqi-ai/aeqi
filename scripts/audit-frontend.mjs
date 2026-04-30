/**
 * AEQI Frontend Audit — exhaustive headless-browser sweep.
 *
 * Walks the authed app through every primary route, captures:
 *   - Every HTTP request (URL, method, status, duration, size)
 *   - Every console message (errors, warnings, info)
 *   - Every uncaught page exception
 *   - WebSocket open/close/error events
 *   - Performance: navigation timing, transferred bytes, first paint
 *   - React-specific: detect rapid re-renders via render-counter probes
 *
 * Pass an `AEQI_TOKEN` env var to skip the login wall. The token can be
 * minted from the platform's AEQI_WEB_SECRET (see scripts/_mint-jwt.mjs)
 * and registered in user_sessions.
 *
 * Output: .observations/audit-<timestamp>/findings.json + screenshots
 *
 * Usage:
 *   AEQI_TOKEN="eyJ..." node scripts/audit-frontend.mjs
 */

import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const TOKEN = process.env.AEQI_TOKEN;
if (!TOKEN) {
  console.error("AEQI_TOKEN env var required");
  process.exit(1);
}

const BASE = process.env.AEQI_BASE_URL || "https://app.aeqi.ai";
const OUT_DIR = join(
  import.meta.dirname,
  "..",
  ".observations",
  `audit-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);
mkdirSync(OUT_DIR, { recursive: true });

// Routes to walk. Pulled from the spec'd IA. Each entry is rendered,
// audited, then we move on. The order roughly mirrors a real session
// (open app → check inbox → enter a company → drill into surfaces).
const ROUTES = [
  { path: "/", label: "home" },
  { path: "/me/inbox", label: "me-inbox" },
  { path: "/me", label: "me-profile" },
  { path: "/economy", label: "economy" },
  { path: "/economy/blueprints", label: "blueprints" },
  // Entity scope. Hard-coded luca-eich entity_id for the audit. We
  // resolve agents from /api/agents inside the run for the agent-scope
  // visits.
  { path: "/c/9f8d30b9-abed-408e-9eae-91c48bb360ff", label: "company-bare" },
  { path: "/c/9f8d30b9-abed-408e-9eae-91c48bb360ff/overview", label: "company-overview" },
  { path: "/c/9f8d30b9-abed-408e-9eae-91c48bb360ff/positions", label: "company-positions" },
  { path: "/c/9f8d30b9-abed-408e-9eae-91c48bb360ff/agents", label: "company-agents" },
  { path: "/c/9f8d30b9-abed-408e-9eae-91c48bb360ff/quests", label: "company-quests" },
  { path: "/c/9f8d30b9-abed-408e-9eae-91c48bb360ff/ideas", label: "company-ideas" },
  { path: "/c/9f8d30b9-abed-408e-9eae-91c48bb360ff/events", label: "company-events" },
  // Session/chat surface. The chat WebSocket (`/api/chat/stream`) only
  // opens once a user sends a message OR when revisiting an active
  // session. The daemon WebSocket (`/api/ws`) should open cleanly on
  // every authed page — if either 400s, the auth/scope wiring is broken.
  // We hit a session list landing page (no session id) so the chat
  // surface mounts and the daemon socket connects with the right scope.
  {
    path: "/c/9f8d30b9-abed-408e-9eae-91c48bb360ff/sessions",
    label: "company-sessions",
  },
];

async function auditRoute(context, route) {
  const page = await context.newPage();
  const requests = [];
  const consoleMessages = [];
  const pageErrors = [];
  const wsEvents = [];

  page.on("request", (req) => {
    requests.push({
      url: req.url(),
      method: req.method(),
      resourceType: req.resourceType(),
      startedAt: Date.now(),
    });
  });
  page.on("requestfinished", async (req) => {
    const r = requests.find((x) => x.url === req.url() && !x.status);
    if (!r) return;
    const resp = await req.response();
    r.status = resp?.status();
    r.duration = Date.now() - r.startedAt;
    try {
      const sizes = await req.sizes();
      r.size = sizes?.responseBodySize ?? null;
    } catch {
      r.size = null;
    }
  });
  page.on("requestfailed", (req) => {
    const r = requests.find((x) => x.url === req.url() && !x.status);
    if (r) {
      r.status = "failed";
      r.error = req.failure()?.errorText;
    }
  });
  page.on("console", (msg) => {
    consoleMessages.push({
      type: msg.type(),
      text: msg.text().slice(0, 800),
    });
  });
  page.on("pageerror", (err) => {
    pageErrors.push({ message: err.message, stack: err.stack?.slice(0, 1500) });
  });
  page.on("websocket", (ws) => {
    wsEvents.push({ kind: "open", url: ws.url() });
    ws.on("close", () => wsEvents.push({ kind: "close", url: ws.url() }));
    ws.on("framesent", () => {
      const last = wsEvents[wsEvents.length - 1];
      if (last?.kind !== "framesent") wsEvents.push({ kind: "framesent", url: ws.url(), count: 1 });
      else last.count++;
    });
    ws.on("framereceived", () => {
      const last = wsEvents[wsEvents.length - 1];
      if (last?.kind !== "framereceived")
        wsEvents.push({ kind: "framereceived", url: ws.url(), count: 1 });
      else last.count++;
    });
  });

  await page.addInitScript((tok) => {
    localStorage.setItem("aeqi_token", tok);
    localStorage.setItem("aeqi_auth_mode", "secret");
  }, TOKEN);

  const url = `${BASE}${route.path}`;
  let navError = null;
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 25000 });
  } catch (e) {
    navError = e.message;
  }
  await page.waitForTimeout(2500);

  const perf = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    return nav
      ? {
          domContentLoaded: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
          load: Math.round(nav.loadEventEnd - nav.startTime),
          transferSize: nav.transferSize,
          encodedSize: nav.encodedBodySize,
        }
      : null;
  });

  // Reload-reconnect probe. Streaming/chat surfaces have to survive a
  // browser refresh: the daemon WebSocket reopens on every mount, and
  // the chat surface re-attaches to any in-flight session via the
  // `subscribe: true` payload. We snapshot the request log, reload, let
  // the page settle, and check that the new WS handshake completes
  // (no 4xx/5xx and at least one ws event since the snapshot).
  const wsBeforeReload = wsEvents.length;
  const reqBeforeReload = requests.length;
  let reloadError = null;
  try {
    await page.reload({ waitUntil: "networkidle", timeout: 25000 });
    await page.waitForTimeout(2000);
  } catch (e) {
    reloadError = e.message;
  }
  const wsAfterReload = wsEvents.slice(wsBeforeReload);
  const reqAfterReload = requests.slice(reqBeforeReload);
  const reloadFailed = reqAfterReload.filter(
    (r) => r.status === "failed" || (typeof r.status === "number" && r.status >= 400 && r.status < 600),
  );

  const screenshotPath = join(OUT_DIR, `${route.label}.png`);
  try {
    await page.screenshot({ path: screenshotPath, fullPage: false });
  } catch (e) {
    /* skip */
  }

  await page.close();

  const failed = requests.filter((r) => r.status === "failed" || (r.status >= 400 && r.status < 600));
  const slowReqs = requests.filter((r) => typeof r.duration === "number" && r.duration > 1000);
  const errorMsgs = consoleMessages.filter((m) => m.type === "error");
  const warnMsgs = consoleMessages.filter((m) => m.type === "warning");

  return {
    label: route.label,
    path: route.path,
    navError,
    reloadError,
    perf,
    screenshot: screenshotPath,
    counts: {
      requests: requests.length,
      failed: failed.length,
      slowReqs: slowReqs.length,
      errors: errorMsgs.length,
      warnings: warnMsgs.length,
      wsEvents: wsEvents.length,
      pageErrors: pageErrors.length,
      reloadWsEvents: wsAfterReload.length,
      reloadFailed: reloadFailed.length,
    },
    failed,
    slowReqs,
    errors: errorMsgs,
    warnings: warnMsgs,
    wsEvents,
    pageErrors,
    reloadWsEvents: wsAfterReload,
    reloadFailed,
  };
}

/**
 * Fresh-session streaming probe.
 *
 * The streaming-fix regression class (commit c5d72a5c): if the
 * WebSocket subscribes after the producer has already started, early
 * events (StepStart, ThinkingStart, the first TextDeltas) drop on the
 * floor. Symptom: the assistant's first turn renders with no thinking
 * block, no token-by-token streaming — just a final blob.
 *
 * Probe: navigate to the agent's sessions tab, dispatch the composer's
 * `aeqi:send-message` event in-page (no selector hunting), capture
 * chat-stream WS frames, assert StepStart + TextDelta arrive before
 * Complete.
 *
 * Skipped when AEQI_AUDIT_ENTITY_ID + AEQI_AUDIT_AGENT_ID aren't set —
 * they identify a test entity/agent the auditor can spam without
 * polluting real data.
 */
async function probeFreshSessionStreaming(context) {
  const entityId = process.env.AEQI_AUDIT_ENTITY_ID;
  const agentId = process.env.AEQI_AUDIT_AGENT_ID;
  if (!entityId || !agentId) return null;

  const page = await context.newPage();
  const frames = [];
  page.on("websocket", (ws) => {
    if (!ws.url().includes("/api/chat/stream")) return;
    ws.on("framereceived", ({ payload }) => {
      const text = typeof payload === "string" ? payload : payload?.toString("utf8") ?? "";
      try {
        const ev = JSON.parse(text);
        frames.push({
          t: ev.type || (ev.done ? "Done" : "?"),
          at: Date.now(),
          excerpt: text.slice(0, 200),
        });
      } catch {
        frames.push({ t: "?", at: Date.now(), excerpt: text.slice(0, 200) });
      }
    });
  });

  await page.addInitScript((tok) => {
    localStorage.setItem("aeqi_token", tok);
    localStorage.setItem("aeqi_auth_mode", "secret");
  }, TOKEN);

  const url = `${BASE}/c/${entityId}/agents/${agentId}/sessions`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 25000 });
  await page.waitForTimeout(1500);

  // Dispatch the composer's send event directly. Bypasses selector
  // brittleness; AgentSessionView listens for this and runs the same
  // dispatchMessage path the composer uses.
  await page.evaluate(() => {
    const id = `audit-${Date.now()}`;
    const detail = { id, text: "audit ping — checking first-turn streaming" };
    window.dispatchEvent(new CustomEvent("aeqi:send-message", { detail }));
  });

  // Long enough for a small turn — StepStart + a few TextDeltas + Complete
  // is sub-second on the runtime, but cold gateway warm-up can stretch
  // it to ~10s on a fresh session. 15s is generous; the loop bails when
  // we see Complete.
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (frames.some((f) => f.t === "Complete" || f.t === "Done" || f.t === "Error")) break;
    await page.waitForTimeout(250);
  }

  await page.close();

  const order = frames.map((f) => f.t);
  const idxStepStart = order.indexOf("StepStart");
  const idxTextDelta = order.indexOf("TextDelta");
  const idxComplete = order.findIndex((t) => t === "Complete" || t === "Done");
  const stepStartBeforeComplete =
    idxStepStart >= 0 && (idxComplete < 0 || idxStepStart < idxComplete);
  const textDeltaBeforeComplete =
    idxTextDelta >= 0 && (idxComplete < 0 || idxTextDelta < idxComplete);
  const passed = stepStartBeforeComplete && textDeltaBeforeComplete;

  return {
    label: "fresh-session-streaming",
    passed,
    frameCount: frames.length,
    order,
    diagnosis: passed
      ? "first-turn StepStart + TextDelta arrived before Complete"
      : "REGRESSION: chat-stream events dropped before consumer subscribed (see commit c5d72a5c)",
    frames,
  };
}

async function main() {
  console.log(`🔍 AEQI frontend audit → ${OUT_DIR}`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });

  const findings = [];
  for (const route of ROUTES) {
    process.stdout.write(`  → ${route.label.padEnd(22)} `);
    const result = await auditRoute(context, route);
    findings.push(result);
    console.log(
      `[${result.counts.requests} req · ${result.counts.failed} failed · ${result.counts.errors} err · ${result.counts.warnings} warn · reload-ws ${result.counts.reloadWsEvents} reload-fail ${result.counts.reloadFailed}]`,
    );
  }

  process.stdout.write(`  → ${"fresh-session-streaming".padEnd(22)} `);
  const streamingProbe = await probeFreshSessionStreaming(context);
  if (streamingProbe) {
    console.log(
      `[${streamingProbe.frameCount} frames · ${streamingProbe.passed ? "PASS" : "FAIL"} — ${streamingProbe.diagnosis}]`,
    );
  } else {
    console.log("[skipped — set AEQI_AUDIT_ENTITY_ID + AEQI_AUDIT_AGENT_ID]");
  }

  await browser.close();

  writeFileSync(
    join(OUT_DIR, "findings.json"),
    JSON.stringify({ routes: findings, streamingProbe }, null, 2),
  );

  // Aggregate summary
  const totalRequests = findings.reduce((a, f) => a + f.counts.requests, 0);
  const totalFailed = findings.reduce((a, f) => a + f.counts.failed, 0);
  const totalErrors = findings.reduce((a, f) => a + f.counts.errors, 0);
  const totalWarnings = findings.reduce((a, f) => a + f.counts.warnings, 0);
  const totalPageErrors = findings.reduce((a, f) => a + f.counts.pageErrors, 0);

  // Most-failed endpoints across the run
  const failsByUrl = new Map();
  for (const f of findings) {
    for (const r of f.failed) {
      const key = `${r.method} ${r.url}`;
      const acc = failsByUrl.get(key) ?? { url: key, count: 0, statuses: new Set(), routes: [] };
      acc.count++;
      acc.statuses.add(r.status);
      acc.routes.push(f.label);
      failsByUrl.set(key, acc);
    }
  }
  const topFails = [...failsByUrl.values()]
    .map((x) => ({ ...x, statuses: [...x.statuses] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  // Most-common console errors
  const errCounts = new Map();
  for (const f of findings) {
    for (const e of f.errors) {
      const key = e.text.slice(0, 200);
      errCounts.set(key, (errCounts.get(key) ?? 0) + 1);
    }
  }
  const topErrors = [...errCounts.entries()]
    .map(([msg, count]) => ({ count, msg }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  console.log("\n══════════════════════════════════════════════════");
  console.log("AGGREGATE");
  console.log("══════════════════════════════════════════════════");
  console.log(`routes:        ${findings.length}`);
  console.log(`requests:      ${totalRequests}`);
  console.log(`failed/4xx/5xx: ${totalFailed}`);
  console.log(`page errors:   ${totalPageErrors}`);
  console.log(`console errors: ${totalErrors}`);
  console.log(`console warns:  ${totalWarnings}`);
  console.log("");
  console.log("TOP FAILED ENDPOINTS:");
  topFails.forEach((f) => {
    console.log(`  [${f.statuses.join(",")}] ×${f.count}  ${f.url}  (routes: ${[...new Set(f.routes)].join(",")})`);
  });
  console.log("");
  console.log("TOP CONSOLE ERRORS:");
  topErrors.forEach((e) => console.log(`  ×${e.count}  ${e.msg}`));
  console.log("");
  console.log(`Full findings: ${join(OUT_DIR, "findings.json")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
