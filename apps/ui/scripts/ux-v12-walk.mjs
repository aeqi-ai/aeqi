#!/usr/bin/env node
/**
 * UX Walk v12 — 2026-05-05
 * Twelfth UX pass. Post v0.26.0 (trust routing live).
 *
 * Key new test: does commit 64046ce3 (client-side trust redirect useEffect)
 * correctly redirect /c/<id>/overview → /trust/<addr>/overview after settle?
 *
 * Trust entity under test (redirect verify):
 *   entity_id: 9642ce17-ea35-4eb2-981a-0d7984a5f759
 *   trust_address: 0xc321f39f8db2a05d664094982bd05b4214b90096
 *   server-side 308: /c/<id>/... → /trust/<addr>/...  (confirmed)
 *
 * Also testing: /trust/<addr>/overview direct hit → expect 200 + full tab render
 *
 * v11 score: 9.6/10
 * Live bundle at walk time: index-CA_Mtab-.js (Wave 26)
 *
 * Per-fix verification v12:
 *   1. Trust routing (64046ce3):
 *      - Cold load /c/<id>/overview → final URL settles at /trust/<addr>/overview
 *      - Direct /trust/<addr>/overview → 200, all tabs render
 *      - SPA navigation to /c/<id>/overview after client auth → client-side
 *        useEffect redirects to /trust/<addr> (tested via same cold-load path)
 *   2. Carry-forward from v11: wallet upgrade 501, director name, docs nav
 *
 * Output:
 *   Screenshots → /home/claudedev/aeqi/.observations/ux-v12/
 *   Raw JSON   → /home/claudedev/aeqi/.observations/ux-v12/raw.json
 *
 * Usage:
 *   AEQI_WEB_SECRET=... node apps/ui/scripts/ux-v12-walk.mjs
 */

import { chromium } from "/home/claudedev/.npm/_npx/420ff84f11983ee5/node_modules/playwright/index.mjs";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import https from "https";
import http from "http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = "/home/claudedev/aeqi";
const SCREENSHOT_DIR = join(REPO_ROOT, ".observations", "ux-v12");
const RAW_JSON = join(SCREENSHOT_DIR, "raw.json");

mkdirSync(SCREENSHOT_DIR, { recursive: true });

// ── Auth setup ────────────────────────────────────────────────────────────────
const AEQI_WEB_SECRET = process.env.AEQI_WEB_SECRET;
if (!AEQI_WEB_SECRET) {
  console.error("AEQI_WEB_SECRET required — set it in env before running");
  process.exit(1);
}

const USER_ID = "bbbd909d-02ab-4ea6-9da2-98d10d4aeba8";
const EMAIL = "eqaq131@gmail.com";

// Primary entity (Luca Eich personal — regression base)
const ENTITY_ID = "9f8d30b9-abed-408e-9eae-91c48bb360ff";
const AGENT_ID = "1b6bcf4e-79f0-4d8e-9a55-501e87149836";

// v11 new-trust entity (regression check — on-chain TRUST verified in v11)
const NEW_ENTITY_ID = "fe1780cb-ce83-44c1-8971-eed846f77941";
const NEW_TRUST_ADDRESS = "0xdb58fd698d6ec8742c8c5af70cdb658e408c10f8";
const NEW_TRUST_ID = "0xfe1780cbce8344c18971eed846f7794100000000000000000000000000000000";

// v12 CRITICAL: Trust routing test entity
// Server-side 308 confirmed: /c/<id>/... → /trust/<addr>/...
const REDIRECT_ENTITY_ID = "9642ce17-ea35-4eb2-981a-0d7984a5f759";
const REDIRECT_TRUST_ADDR = "0xc321f39f8db2a05d664094982bd05b4214b90096";

const TOKEN = execSync(
  `AEQI_WEB_SECRET="${AEQI_WEB_SECRET}" node /home/claudedev/aeqi/scripts/_mint-jwt.mjs ${USER_ID} ${EMAIL} 7200`,
  { encoding: "utf-8" },
).trim();

console.log(`JWT minted: ${TOKEN.slice(0, 40)}...`);
console.log(`Primary entity: ${ENTITY_ID} (Luca Eich)`);
console.log(`v11 NEW entity: ${NEW_ENTITY_ID} (trust @ ${NEW_TRUST_ADDRESS})`);
console.log(`v12 redirect test entity: ${REDIRECT_ENTITY_ID} (trust @ ${REDIRECT_TRUST_ADDR})`);
console.log(`Live bundle: index-CA_Mtab-.js (Wave 26)`);

// ── v12-E: Pre-walk indexer probe ────────────────────────────────────────────
async function probeIndexer() {
  const result = {};

  // trustsCount
  await new Promise((resolve) => {
    const body = JSON.stringify({ query: "{ trustsCount }" });
    const req = http.request(
      {
        hostname: "localhost",
        port: 8501,
        path: "/graphql",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            result.trustsCount = parsed.data?.trustsCount ?? -1;
          } catch (_) {
            result.trustsCount = -1;
          }
          resolve();
        });
      },
    );
    req.on("error", () => { result.trustsCount = -1; resolve(); });
    req.write(body);
    req.end();
  });

  // roles for v11 new-trust entity (regression check)
  await new Promise((resolve) => {
    const gqlQuery = `{ rolesForTrust(trustId: "${NEW_TRUST_ID}") { account roleTypeId slotIndex } }`;
    const body = JSON.stringify({ query: gqlQuery });
    const req = http.request(
      {
        hostname: "localhost",
        port: 8501,
        path: "/graphql",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            result.newEntityRoles = parsed.data?.rolesForTrust ?? [];
          } catch (_) {
            result.newEntityRoles = [];
          }
          resolve();
        });
      },
    );
    req.on("error", () => { result.newEntityRoles = []; resolve(); });
    req.write(body);
    req.end();
  });

  return result;
}

// ── Wallet upgrade API probe ──────────────────────────────────────────────────
async function probeWalletUpgradeApi(token) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ credential: "test-probe" });
    const req = https.request(
      {
        hostname: "app.aeqi.ai",
        path: "/api/wallet/upgrade-to-passkey",
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          resolve({ status: res.statusCode, body: data.slice(0, 200) });
        });
      },
    );
    req.on("error", (err) => resolve({ status: -1, error: err.message }));
    req.write(body);
    req.end();
  });
}

// ── v12: Server-side 308 redirect probe ──────────────────────────────────────
async function probeServerRedirect() {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "app.aeqi.ai",
        path: `/c/${REDIRECT_ENTITY_ID}/overview`,
        method: "GET",
        headers: { Cookie: `aeqi_token=${TOKEN}` },
      },
      (res) => {
        resolve({
          status: res.statusCode,
          location: res.headers["location"] ?? null,
        });
      },
    );
    req.on("error", (err) => resolve({ status: -1, error: err.message }));
    req.end();
  });
}

console.log("\n=== v12-E: Pre-walk probes ===");
const indexerProbe = await probeIndexer();
console.log(`trustsCount: ${indexerProbe.trustsCount}`);
console.log(`v11 entity roles (regression): ${JSON.stringify(indexerProbe.newEntityRoles)}`);

const walletProbeResult = await probeWalletUpgradeApi(TOKEN);
console.log(`\nWallet upgrade API probe: HTTP ${walletProbeResult.status} — ${walletProbeResult.body}`);
const walletUpgradeIs501 = walletProbeResult.status === 501;
const walletUpgradeIs401 = walletProbeResult.status === 401;
console.log(
  walletUpgradeIs501
    ? "  [PASS] Returns 501 — 3dfcc03 DEPLOYED"
    : walletUpgradeIs401
      ? "  [FAIL] Still 401 — 3dfcc03 NOT deployed"
      : `  [?] Unexpected status ${walletProbeResult.status}`,
);

const serverRedirectProbe = await probeServerRedirect();
const expectedLocation = `/trust/${REDIRECT_TRUST_ADDR}/overview`;
const serverRedirectOk = serverRedirectProbe.status === 308 &&
  serverRedirectProbe.location === expectedLocation;
console.log(`\nServer-side redirect probe: HTTP ${serverRedirectProbe.status} Location: ${serverRedirectProbe.location}`);
console.log(
  serverRedirectOk
    ? `  [PASS] 308 → ${expectedLocation}`
    : `  [FAIL] Expected 308 + ${expectedLocation}, got ${serverRedirectProbe.status} ${serverRedirectProbe.location}`,
);

// ── Route manifest ────────────────────────────────────────────────────────────
const ROUTES = [
  { url: "https://aeqi.ai/", label: "landing-home", auth: false },
  { url: "https://aeqi.ai/docs", label: "landing-docs", auth: false },
  { url: "https://aeqi.ai/economy", label: "landing-economy", auth: false },
  { url: "https://app.aeqi.ai/signup", label: "app-signup", auth: false },
  { url: "https://app.aeqi.ai/signin", label: "app-signin", auth: false },
  { url: "https://app.aeqi.ai/", label: "app-root", auth: true },
  { url: `https://app.aeqi.ai/me`, label: "me-root", auth: true },
  { url: `https://app.aeqi.ai/me/agents`, label: "me-agents", auth: true },
  { url: `https://app.aeqi.ai/me/quests`, label: "me-quests", auth: true },
  { url: `https://app.aeqi.ai/me/ideas`, label: "me-ideas", auth: true },
  { url: `https://app.aeqi.ai/me/events`, label: "me-events", auth: true },
  { url: `https://app.aeqi.ai/me/treasury`, label: "me-treasury", auth: true },
  { url: `https://app.aeqi.ai/me/settings`, label: "me-settings", auth: true },
  // Original entity (regression base)
  { url: `https://app.aeqi.ai/c/${ENTITY_ID}`, label: "company-overview", auth: true },
  { url: `https://app.aeqi.ai/c/${ENTITY_ID}/roles`, label: "company-roles", auth: true },
  { url: `https://app.aeqi.ai/c/${ENTITY_ID}/ownership`, label: "company-ownership", auth: true },
  { url: `https://app.aeqi.ai/c/${ENTITY_ID}/treasury`, label: "company-treasury", auth: true },
  { url: `https://app.aeqi.ai/c/${ENTITY_ID}/governance`, label: "company-governance", auth: true },
  { url: `https://app.aeqi.ai/c/${ENTITY_ID}/settings`, label: "company-settings", auth: true },
  { url: `https://app.aeqi.ai/c/${ENTITY_ID}/agents/${AGENT_ID}`, label: "agent-overview", auth: true },
  { url: `https://app.aeqi.ai/c/${ENTITY_ID}/agents/${AGENT_ID}/sessions`, label: "agent-sessions", auth: true },
  { url: `https://app.aeqi.ai/c/${ENTITY_ID}/agents/${AGENT_ID}/quests`, label: "agent-quests", auth: true },
  { url: `https://app.aeqi.ai/c/${ENTITY_ID}/agents/${AGENT_ID}/events`, label: "agent-events", auth: true },
  { url: `https://app.aeqi.ai/c/${ENTITY_ID}/agents/${AGENT_ID}/ideas`, label: "agent-ideas", auth: true },
  // v11 new-trust entity tabs (regression check — confirmed working in v11)
  { url: `https://app.aeqi.ai/c/${NEW_ENTITY_ID}`, label: "new-company-overview", auth: true, isNewTrust: true },
  { url: `https://app.aeqi.ai/c/${NEW_ENTITY_ID}/ownership`, label: "new-company-ownership", auth: true, isNewTrust: true },
  { url: `https://app.aeqi.ai/c/${NEW_ENTITY_ID}/treasury`, label: "new-company-treasury", auth: true, isNewTrust: true },
  { url: `https://app.aeqi.ai/c/${NEW_ENTITY_ID}/governance`, label: "new-company-governance", auth: true, isNewTrust: true },
  // v12 CRITICAL: Trust routing — /c/<id> redirects to /trust/<addr>
  { url: `https://app.aeqi.ai/c/${REDIRECT_ENTITY_ID}/overview`, label: "trust-redirect-test", auth: true, isTrustRedirect: true },
  // v12 CRITICAL: Direct /trust/<addr>/overview hit — expect 200 + full render
  { url: `https://app.aeqi.ai/trust/${REDIRECT_TRUST_ADDR}/overview`, label: "trust-direct-hit", auth: true, isTrustDirect: true },
  // Other app routes
  { url: `https://app.aeqi.ai/blueprints`, label: "app-blueprints", auth: true },
  { url: `https://app.aeqi.ai/economy`, label: "app-economy", auth: true },
  { url: `https://app.aeqi.ai/start`, label: "app-start", auth: true },
];

// ── Anti-pattern detector (inherited from v11 — no core changes) ──────────────
const DETECT_ANTIPATTERNS = `() => {
  const issues = [];
  const body = document.body;
  if (!body) return issues;
  const allText = body.innerText || "";

  // 1. Raw CSS variable literals in text
  if (/var\\(--[a-z][a-z0-9-]+\\)|^--[a-z][a-z0-9-]+:/gm.test(allText)) {
    issues.push({ code: "TOKEN_LITERAL", severity: "P1",
      detail: "Raw CSS var() visible in rendered text" });
  }

  // 2. "undefined" text
  const undefs = (allText.match(/\\bundefined\\b/g) || []).filter(m => m === "undefined");
  if (undefs.length > 0) {
    issues.push({ code: "UNDEFINED_TEXT", severity: "P0",
      detail: "'undefined' appears " + undefs.length + "x" });
  }

  // 3. AEQI uppercase structural check (v8+: excludes session-rail)
  const sessionRailExclude = new Set(
    Array.from(document.querySelectorAll(
      "[class*=sessions-rail],[class*=session-rail],[class*=sessions-sidebar],[class*=session-sidebar],[class*=sessions-list]"
    ))
  );
  const sessionRailDescendants = new Set();
  for (const el of sessionRailExclude) {
    for (const desc of Array.from(el.querySelectorAll("*"))) {
      sessionRailDescendants.add(desc);
    }
  }

  const structuralEls = Array.from(document.querySelectorAll(
    "nav, header, [class*=sidebar],[class*=rail],[class*=Sidebar],[class*=Rail]," +
    "h1,h2,h3,h4,[placeholder],[aria-label],[class*=mission],[class*=Mission]," +
    "[class*=identity],[class*=Identity],[class*=label],[class*=Label]"
  )).filter(el => !sessionRailExclude.has(el) && !sessionRailDescendants.has(el));

  let structuralAeqiCount = 0;
  const structuralAeqiExamples = [];
  for (const el of structuralEls) {
    const t = el.innerText || el.getAttribute("placeholder") || el.getAttribute("aria-label") || "";
    const matches = t.match(/\\bAEQI\\b/g);
    if (matches) {
      structuralAeqiCount += matches.length;
      if (structuralAeqiExamples.length < 3) {
        structuralAeqiExamples.push("<" + el.tagName + "> \\"" + t.trim().slice(0,50) + "\\"");
      }
    }
  }
  if (structuralAeqiCount > 0) {
    issues.push({ code: "AEQI_UPPERCASE_STRUCTURAL", severity: "P1",
      detail: "Uppercase AEQI " + structuralAeqiCount + "x in structural copy. Examples: " + structuralAeqiExamples.join("; ") });
  }

  // 3b. Total AEQI count
  const totalAeqi = (allText.match(/\\bAEQI\\b/g) || []).length;
  if (totalAeqi > 0) {
    issues.push({ code: "AEQI_UPPERCASE_TOTAL", severity: "info",
      detail: "Uppercase AEQI " + totalAeqi + "x total (includes user-generated content)" });
  }

  // 4. Pill buttons
  const interactiveEls = Array.from(
    document.querySelectorAll("button, [role=button], a.btn, .btn")
  ).slice(0, 100);
  let actionPillCount = 0;
  let avatarPillCount = 0;
  const actionPillExamples = [];
  for (const el of interactiveEls) {
    const r = parseFloat(window.getComputedStyle(el).borderRadius);
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const text = (el.textContent || "").trim().slice(0, 30);
    if (r > 8) {
      const isIconLike = Math.abs(w - h) < 12 && h <= 56 && text.length <= 3;
      const isPill = r >= h * 0.4 && !isIconLike;
      if (isPill) {
        actionPillCount++;
        if (actionPillExamples.length < 5) {
          actionPillExamples.push(r + "px \\"" + text + "\\" inlineStyle=" + (el.style.borderRadius || "none"));
        }
      } else {
        avatarPillCount++;
      }
    }
  }
  if (actionPillCount > 0) {
    issues.push({ code: "ACTION_PILL_BUTTONS", severity: "P1",
      detail: actionPillCount + " action pill buttons. Examples: " + actionPillExamples.join("; ") });
  }
  if (avatarPillCount > 0) {
    issues.push({ code: "ICON_PILL_BUTTONS", severity: "info",
      detail: avatarPillCount + " icon/avatar circular elements (expected)" });
  }

  // 4b. Inline borderRadius 999px
  const inlinePills = Array.from(document.querySelectorAll("[style*='999']")).slice(0, 30).filter(el => {
    return (el.style.borderRadius || "").includes("999");
  });
  if (inlinePills.length > 0) {
    issues.push({ code: "INLINE_999PX_RADIUS", severity: "P0",
      detail: inlinePills.length + " elements with inline borderRadius 999px" });
  }

  // 5. Hairlines
  let hairlineCount = 0;
  for (const el of Array.from(document.querySelectorAll("*")).slice(0, 400)) {
    const s = window.getComputedStyle(el);
    if (parseFloat(s.borderTopWidth) === 1
        && s.borderTopStyle !== "none"
        && s.borderTopColor !== "rgba(0, 0, 0, 0)") {
      hairlineCount++;
    }
  }
  if (hairlineCount > 5) {
    issues.push({ code: "HAIRLINES", severity: "P2",
      detail: hairlineCount + " elements with 1px hairline borders" });
  }

  // 6. JetBrains Mono
  for (const el of Array.from(document.querySelectorAll("*")).slice(0, 150)) {
    const ff = window.getComputedStyle(el).fontFamily || "";
    if (ff.toLowerCase().includes("jetbrains")) {
      issues.push({ code: "JETBRAINS_MONO", severity: "P1",
        detail: "JetBrains Mono on <" + el.tagName + ">" });
      break;
    }
  }

  // 7. Gradient text
  for (const el of Array.from(document.querySelectorAll("*")).slice(0, 300)) {
    const s = window.getComputedStyle(el);
    if (s.backgroundImage && s.backgroundImage.includes("gradient") && s.webkitBackgroundClip === "text") {
      issues.push({ code: "GRADIENT_TEXT", severity: "P1",
        detail: "Gradient text on <" + el.tagName + "> \\"" + (el.textContent||"").trim().slice(0,40) + "\\"" });
      break;
    }
  }

  // 8. Fuchsia avatars
  for (const el of Array.from(document.querySelectorAll(
    "[class*=avatar], [class*=Avatar], [class*=dot], [class*=indicator]"
  )).slice(0, 20)) {
    const bg = window.getComputedStyle(el).backgroundColor;
    const m = bg.match(/rgb\\((\\d+),\\s*(\\d+),\\s*(\\d+)\\)/);
    if (m) {
      const [, r, g, b] = m.map(Number);
      if (r > 150 && g < 80 && b > 80 && r > b) {
        issues.push({ code: "FUCHSIA_AVATAR", severity: "P1",
          detail: "Fuchsia color " + bg + " on " + el.className.slice(0,40) });
        break;
      }
    }
  }

  // 9. 404 page
  if (/404|not found|page not found/i.test(allText) && allText.length < 500) {
    issues.push({ code: "404_PAGE", severity: "P0", detail: "404 rendered" });
  }

  // 10. Personal rail leak
  if (window.location.pathname.startsWith("/me")) {
    const sidebarEl = document.querySelector("[class*=sidebar],[class*=rail],[class*=nav],[class*=Sidebar]");
    const sidebarText = (sidebarEl || {}).innerText || "";
    if (/Ownership|Governance/i.test(sidebarText)) {
      issues.push({ code: "PERSONAL_RAIL_LEAK", severity: "P1",
        detail: "Personal rail shows Ownership/Governance (company-only tabs)" });
    }
  }

  // 11. Jade/teal badges
  const badgeEls = Array.from(document.querySelectorAll(
    "[class*=badge],[class*=Badge],[class*=tag],[class*=Tag],[class*=chip],[class*=Chip],[class*=pill],[class*=count]"
  )).slice(0, 60);
  let jadeBadgeCount = 0;
  const jadeBadgeExamples = [];
  for (const el of badgeEls) {
    const s = window.getComputedStyle(el);
    for (const colorProp of [s.color, s.backgroundColor]) {
      const m = colorProp.match(/rgb\\((\\d+),\\s*(\\d+),\\s*(\\d+)\\)/);
      if (m) {
        const [, r, g, b] = m.map(Number);
        if (g > 100 && g > r * 1.3 && g > b * 0.8 && b > 70) {
          jadeBadgeCount++;
          if (jadeBadgeExamples.length < 3) {
            jadeBadgeExamples.push("\\"" + (el.textContent||"").trim().slice(0,20) + "\\" bg=" + s.backgroundColor + " class=" + (el.className || "").slice(0,30));
          }
          break;
        }
      }
    }
  }
  if (jadeBadgeCount > 0) {
    issues.push({ code: "JADE_BADGE_NON_SUCCESS", severity: "P1",
      detail: jadeBadgeCount + " badge(s) with jade/teal color. Examples: " + jadeBadgeExamples.join("; ") });
  }

  // 12. Raw UUID in headings
  const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const uuidMatches = allText.match(uuidPattern) || [];
  if (uuidMatches.length > 0) {
    const headings = Array.from(document.querySelectorAll("h1,h2,h3,.heading,strong")).slice(0, 30);
    let uuidInHeading = false;
    let uuidHeadingText = "";
    for (const h of headings) {
      const hText = h.innerText || "";
      if (uuidPattern.test(hText)) {
        uuidInHeading = true;
        uuidHeadingText = hText.trim().slice(0, 60);
        uuidPattern.lastIndex = 0;
        break;
      }
      uuidPattern.lastIndex = 0;
    }
    if (uuidInHeading) {
      issues.push({ code: "UUID_AS_LABEL", severity: "P1",
        detail: 'Raw UUID in heading: "' + uuidHeadingText + '"' });
    }
  }

  // 13. "See proposals" build note
  if (allText.includes("See proposals") && allText.includes("Phase 2")) {
    issues.push({ code: "BUILD_NOTE_EXPOSED", severity: "P2",
      detail: '"See proposals (Phase 2)" internal note visible' });
  }

  // 14. Button radius summary
  const actionBtns = Array.from(document.querySelectorAll("button.btn, .btn-primary, .btn-secondary, [class*=button]")).slice(0, 20);
  let correctRadiusCount = 0;
  let wrongRadiusCount = 0;
  for (const btn of actionBtns) {
    const r = parseFloat(window.getComputedStyle(btn).borderRadius);
    const text = (btn.textContent || "").trim();
    if (text.length > 2) {
      if (r > 8) wrongRadiusCount++;
      else correctRadiusCount++;
    }
  }
  issues.push({ code: "BUTTON_RADIUS_CHECK", severity: "info",
    detail: "Buttons: " + correctRadiusCount + " correct (<=8px), " + wrongRadiusCount + " wrong (>8px)" });

  // 15. Governance error elements
  if (window.location.pathname.includes("governance")) {
    const errorEls = Array.from(document.querySelectorAll("[class*=error],[class*=Error]")).slice(0,5);
    for (const el of errorEls) {
      const t = (el.innerText || "").trim();
      if (t.length > 0 && t.length < 300) {
        issues.push({ code: "GOV_ERROR_ELEMENT", severity: "P1",
          detail: 'Governance error: "' + t.slice(0,80) + '"' });
      }
    }
  }

  // 16. Settings UUID in h3
  if (window.location.pathname.includes("settings")) {
    const uuidPat = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
    const h3els = Array.from(document.querySelectorAll("h3")).slice(0, 20);
    for (const h3 of h3els) {
      const t = (h3.innerText || "").trim();
      if (uuidPat.test(t)) {
        issues.push({ code: "H3_UUID_PLAN_CARD", severity: "P0",
          detail: 'h3 contains UUID: "' + t.slice(0, 60) + '"' });
      }
    }
  }

  // 17. Hardcoded fontsize
  const inlineFont13 = Array.from(document.querySelectorAll("[style*='font-size: 13'],[style*='fontSize: 13'],[style*='font-size:13']")).slice(0,10);
  const inlineFont14 = Array.from(document.querySelectorAll("[style*='font-size: 14'],[style*='fontSize: 14'],[style*='font-size:14']")).slice(0,10);
  if (inlineFont13.length > 0 || inlineFont14.length > 0) {
    issues.push({ code: "HARDCODED_FONTSIZE", severity: "P2",
      detail: "Hardcoded font-size: " + inlineFont13.length + "x 13px, " + inlineFont14.length + "x 14px" });
  }

  return issues;
}`;

// ── Core visit function ────────────────────────────────────────────────────────
async function visitRoute(context, route, walletProbeResult, indexerProbeResult, serverRedirectProbe) {
  const page = await context.newPage();
  const networkFailures = [];
  const consoleErrors = [];

  page.on("response", (res) => {
    const s = res.status();
    const u = res.url();
    if (s >= 400 && !u.includes("favicon") && !u.includes("analytics") && !u.includes("plausible")) {
      networkFailures.push({ url: u, status: s });
    }
  });

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (!text.includes("favicon") && !text.includes("ERR_NAME_NOT_RESOLVED")) {
        consoleErrors.push(text);
      }
    }
  });

  page.on("pageerror", (err) => {
    consoleErrors.push(`PAGEERROR: ${err.message}`);
  });

  const t0 = Date.now();
  let httpStatus = null;
  let finalUrl = route.url;
  let screenshotPath = null;
  let antiPatterns = [];
  let bodyTextSample = "";
  let fcpMs = null;

  try {
    const response = await page.goto(route.url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    httpStatus = response?.status() ?? null;
    finalUrl = page.url();

    try {
      fcpMs = await page.evaluate(() => {
        const entries = performance.getEntriesByType("paint");
        const e = entries.find((e) => e.name === "first-contentful-paint");
        return e ? Math.round(e.startTime) : null;
      });
    } catch (_) {}

    // Extra wait for routes that need client-side data fetch / redirect
    const waitMs = (route.isNewTrust || route.isTrustRedirect || route.isTrustDirect) ? 5000 : 2500;
    await page.waitForTimeout(waitMs);

    // Capture final URL after any client-side redirects have fired
    finalUrl = page.url();

    screenshotPath = join(SCREENSHOT_DIR, `${route.label}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`  screenshot: ${screenshotPath}`);
    console.log(`  final URL: ${finalUrl}`);

    try {
      bodyTextSample = await page.evaluate(() => (document.body.innerText || "").slice(0, 5000));
    } catch (_) {}

    try {
      antiPatterns = await page.evaluate(new Function(`return (${DETECT_ANTIPATTERNS})()`));
    } catch (e) {
      console.warn(`  anti-pattern eval error on ${route.label}: ${e.message}`);
    }

    // ── v12 specific checks ──
    try {
      const v12Issues = await page.evaluate(
        (args) => {
          const {
            walletProbeStatus, walletProbeBody,
            indexerTrustCount, indexerRoles,
            isNewTrust, isTrustRedirect, isTrustDirect,
            redirectEntityId, redirectTrustAddr,
            serverRedirectStatus, serverRedirectLocation,
          } = args;
          const issues = [];
          const allText = document.body ? (document.body.innerText || "") : "";
          const path = window.location.pathname;

          // ── v12-A: Trust routing — redirect test (client-side + server-side) ──
          if (isTrustRedirect) {
            const expectedPath = "/trust/" + redirectTrustAddr + "/overview";
            const isOnTrustPath = path.startsWith("/trust/");
            const isOnExpectedPath = path === expectedPath;
            const isStillOnCPath = path.includes("/c/" + redirectEntityId);

            if (isOnExpectedPath) {
              issues.push({ code: "TRUST_REDIRECT_PASS", severity: "info",
                detail: "PASS: /c/<id>/overview redirected to " + path + " (expected: " + expectedPath + ")" });
            } else if (isOnTrustPath) {
              issues.push({ code: "TRUST_REDIRECT_PARTIAL", severity: "P2",
                detail: "Partial: on /trust/ path but not expected addr. Got: " + path + " Expected: " + expectedPath });
            } else if (isStillOnCPath) {
              issues.push({ code: "TRUST_REDIRECT_FAIL_STILL_ON_C", severity: "P1",
                detail: "FAIL: still on /c/ after 5s. 64046ce3 redirect not firing. path=" + path });
            } else {
              issues.push({ code: "TRUST_REDIRECT_UNEXPECTED", severity: "P1",
                detail: "Unexpected final path: " + path + " (started: /c/" + redirectEntityId + "/overview)" });
            }

            // Server-side 308 pre-probe result
            if (serverRedirectStatus === 308) {
              issues.push({ code: "SERVER_308_CONFIRMED", severity: "info",
                detail: "Server-side 308 confirmed: " + serverRedirectLocation });
            } else {
              issues.push({ code: "SERVER_308_MISSING", severity: "P0",
                detail: "Server-side 308 NOT returned (got " + serverRedirectStatus + "). Expected 308 → /trust/<addr>/overview" });
            }

            // Check content renders after redirect
            const hasContent = allText.length > 200;
            const has404 = /404|page not found/i.test(allText) && allText.length < 500;
            if (has404) {
              issues.push({ code: "TRUST_REDIRECT_404", severity: "P0",
                detail: "404 rendered after redirect to " + path });
            } else if (hasContent) {
              issues.push({ code: "TRUST_REDIRECT_CONTENT_OK", severity: "info",
                detail: "Content rendered at redirected URL (" + allText.length + " chars)" });
            }
          }

          // ── v12-B: Trust direct hit — /trust/<addr>/overview ──
          if (isTrustDirect) {
            const isOnTrustPath = path.startsWith("/trust/");
            const hasContent = allText.length > 200;
            const has404 = /404|page not found/i.test(allText) && allText.length < 500;
            const hasErrorState = /error|failed|unable to load|something went wrong/i.test(allText.slice(0, 1000));

            if (has404) {
              issues.push({ code: "TRUST_DIRECT_404", severity: "P0",
                detail: "Direct /trust/<addr>/overview returns 404. Route not registered." });
            } else if (hasErrorState) {
              issues.push({ code: "TRUST_DIRECT_ERROR", severity: "P1",
                detail: "Direct /trust/<addr>/overview shows error state." });
            } else if (isOnTrustPath && hasContent) {
              issues.push({ code: "TRUST_DIRECT_RENDERS", severity: "info",
                detail: "PASS: /trust/<addr>/overview renders content (" + allText.length + " chars) at " + path });
            } else if (!isOnTrustPath) {
              issues.push({ code: "TRUST_DIRECT_REDIRECTED_AWAY", severity: "P1",
                detail: "Direct /trust/<addr>/overview was redirected away to: " + path });
            } else {
              issues.push({ code: "TRUST_DIRECT_NO_CONTENT", severity: "P1",
                detail: "Direct /trust/<addr>/overview: on trust path but minimal content. Possible render fail." });
            }

            // Check all company tabs are accessible via /trust/ path
            const hasRoles = /Roles/i.test(allText);
            const hasOwnership = /Ownership/i.test(allText);
            const hasGovernance = /Governance/i.test(allText);
            const hasTreasury = /Treasury/i.test(allText);
            const tabsVisible = [hasRoles, hasOwnership, hasGovernance, hasTreasury].filter(Boolean).length;
            issues.push({ code: "TRUST_DIRECT_TABS_COUNT", severity: tabsVisible >= 3 ? "info" : "P2",
              detail: "Trust direct: " + tabsVisible + "/4 company tabs visible (Roles=" + hasRoles + " Ownership=" + hasOwnership + " Governance=" + hasGovernance + " Treasury=" + hasTreasury + ")" });
          }

          // ── v11 carry-forward checks ──

          // v11-A: On-chain Ownership tab — v11 new entity (regression)
          if (isNewTrust && path.includes("ownership")) {
            const hasRoleSection = /Roles|role|member|owner|director/i.test(allText);
            const hasIndexerRoles = indexerRoles && indexerRoles.length > 0;
            const hasAccountAddress = allText.includes("0x");
            const hasEmptyState = /no roles|no members|nothing here|empty|not configured/i.test(allText);
            const hasErrorState = /error|failed|unable to load|something went wrong/i.test(allText.slice(0, 1000));

            if (hasErrorState) {
              issues.push({ code: "OWNERSHIP_RENDER_ERROR", severity: "P0",
                detail: "v11 entity ownership tab shows error state (regression)" });
            } else if (hasIndexerRoles) {
              issues.push({ code: "OWNERSHIP_DATA_RENDERS", severity: "info",
                detail: "v11 regression OK: ownership renders role data. roles=" + indexerRoles.length + " hasAddr=" + hasAccountAddress });
            } else {
              issues.push({ code: "OWNERSHIP_NO_INDEXER_DATA", severity: "info",
                detail: "v11 entity ownership: indexer returned 0 roles. hasSection=" + hasRoleSection });
            }
          }

          // v11-B: Treasury tab — v11 new entity (regression)
          if (isNewTrust && path.includes("treasury")) {
            const hasErrorState = /error|failed|unable to load|something went wrong/i.test(allText.slice(0, 1000));
            const hasTreasuryContent = /treasury|balance|token|asset|holdings/i.test(allText);

            if (hasErrorState) {
              issues.push({ code: "TREASURY_RENDER_ERROR", severity: "P0",
                detail: "v11 entity treasury tab shows error state (regression)" });
            } else if (hasTreasuryContent) {
              issues.push({ code: "TREASURY_RENDERS_OK", severity: "info",
                detail: "v11 regression OK: treasury tab renders without error" });
            } else {
              issues.push({ code: "TREASURY_NO_CONTENT", severity: "P1",
                detail: "v11 entity treasury: no treasury-related content detected" });
            }
          }

          // v11-C: Governance tab — v11 new entity (regression)
          if (isNewTrust && path.includes("governance")) {
            const hasErrorState = /error|failed|unable to load|something went wrong/i.test(allText.slice(0, 1000));
            const hasGovContent = /governance|proposal|vote|quorum|dao/i.test(allText);
            const errorEls = Array.from(document.querySelectorAll("[class*=error],[class*=Error]")).slice(0, 5);
            const errorTexts = errorEls.map(el => (el.innerText || "").trim()).filter(t => t.length > 0 && t.length < 300);

            if (errorTexts.length > 0) {
              issues.push({ code: "GOVERNANCE_RENDER_ERROR", severity: "P0",
                detail: "v11 entity governance shows visible error element (regression): " + errorTexts[0].slice(0, 80) });
            } else if (hasGovContent) {
              issues.push({ code: "GOVERNANCE_RENDERS_OK", severity: "info",
                detail: "v11 regression OK: governance renders without error" });
            } else {
              issues.push({ code: "GOVERNANCE_NO_CONTENT", severity: "P1",
                detail: "v11 entity governance: no governance-related content (regression)" });
            }
          }

          // v11-D: trustsCount probe
          if (path === "/" || path === "/me") {
            const countOk = indexerTrustCount >= 11;
            issues.push({
              code: countOk ? "INDEXER_TRUSTS_OK" : "INDEXER_TRUSTS_LOW",
              severity: countOk ? "info" : "P1",
              detail: "trustsCount from indexer: " + indexerTrustCount + (countOk ? " (expected >=11)" : " — expected >=11")
            });
          }

          // v12-F: Hairline count (v12 version tag)
          let hlCount = 0;
          for (const el of Array.from(document.querySelectorAll("*")).slice(0, 400)) {
            const s = window.getComputedStyle(el);
            if (parseFloat(s.borderTopWidth) === 1
                && s.borderTopStyle !== "none"
                && s.borderTopColor !== "rgba(0, 0, 0, 0)") {
              hlCount++;
            }
          }
          issues.push({ code: "HAIRLINE_COUNT_V12", severity: "info",
            detail: "v12 hairline count: " + hlCount + " (threshold >5 = P2)" });

          // v12-G: wallet upgrade (carry-forward)
          if (path.startsWith("/me") && path.includes("settings")) {
            if (walletProbeStatus === 501) {
              issues.push({ code: "WALLET_UPGRADE_501_DEPLOYED", severity: "info",
                detail: "3dfcc03 CONFIRMED: returns 501. Graceful-degrade fires." });
            } else if (walletProbeStatus === 401) {
              issues.push({ code: "WALLET_UPGRADE_STILL_401", severity: "P2",
                detail: "3dfcc03 NOT DEPLOYED: still 401." });
            } else {
              issues.push({ code: "WALLET_UPGRADE_UNEXPECTED", severity: "info",
                detail: "Wallet probe status " + walletProbeStatus + " body: " + walletProbeBody });
            }
          }

          // v12-H: Director card check (carry-forward)
          if (path.includes("/roles") && !path.match(/\/roles\/[0-9a-f]/)) {
            const USER_UUID = "bbbd909d-02ab-4ea6-9da2-98d10d4aeba8";
            if (allText.includes(USER_UUID)) {
              const directorIdx = allText.indexOf("Director");
              const uuidIdx = allText.indexOf(USER_UUID);
              const proximity = Math.abs(directorIdx - uuidIdx);
              if (directorIdx >= 0 && proximity < 200) {
                issues.push({ code: "DIRECTOR_UUID_IN_LIST_VIEW", severity: "P2",
                  detail: "Director card shows raw UUID. Proximity: " + proximity + " chars." });
              }
            } else {
              const directorIdx = allText.indexOf("Director");
              if (directorIdx >= 0) {
                const ctx = allText.slice(Math.max(0, directorIdx - 10), directorIdx + 120);
                const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
                if (!uuidRe.test(ctx)) {
                  issues.push({ code: "DIRECTOR_NAME_RESOLVED", severity: "info",
                    detail: "Director occupant name resolved (no UUID adjacent)." });
                }
              }
            }
          }

          // v12-I: Company identity tile AEQI check
          if (path.match(/^\/c\/[0-9a-f-]+\/?$/) && !path.match(/\/c\/[0-9a-f-]+\/[a-z]/)) {
            const missionEls = Array.from(document.querySelectorAll(
              "[class*=mission],[class*=Mission],[class*=identity],[class*=Identity],[class*=overview],[class*=Overview]"
            )).slice(0, 10);
            let missionAeqi = false;
            for (const el of missionEls) {
              if (/\\bAEQI\\b/.test(el.innerText || "")) {
                missionAeqi = true;
                issues.push({ code: "MISSION_AEQI_UPPERCASE", severity: "P2",
                  detail: "Identity tile has uppercase AEQI (DB-stored pre-fix record)" });
                break;
              }
            }
            if (!missionAeqi) {
              issues.push({ code: "MISSION_AEQI_CLEAN", severity: "info",
                detail: "Company overview identity tile: no uppercase AEQI" });
            }
          }

          // v12-J: docs nav check (carry-forward)
          if (window.location.hostname.includes("aeqi.ai") && !window.location.hostname.includes("app.")) {
            const navEls = Array.from(document.querySelectorAll("nav, [class*=nav], aside, ASIDE"));
            let foundLowercase = false;
            let foundUppercase = false;
            for (const el of navEls) {
              const t = el.innerText || "";
              if (t.includes("aeqi Entity")) foundLowercase = true;
              if (t.includes("AEQI Entity")) foundUppercase = true;
            }
            if (foundUppercase) {
              issues.push({ code: "DOCS_NAV_AEQI_UPPERCASE", severity: "P1",
                detail: "Docs nav still shows 'AEQI Entity & AA' (uppercase)." });
            } else if (foundLowercase) {
              issues.push({ code: "DOCS_NAV_AEQI_FIXED", severity: "info",
                detail: "5ba89fe confirmed: docs nav shows 'aeqi Entity & AA' (lowercase)." });
            }
          }

          // v12-K: UUID in page text (info)
          const uuidRe3 = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
          const allUuids = allText.match(uuidRe3) || [];
          if (allUuids.length > 0) {
            issues.push({ code: "UUID_IN_PAGE_TEXT", severity: "info",
              detail: allUuids.length + " UUID(s) in page: " + allUuids.slice(0, 3).join(", ") });
          }

          return issues;
        },
        {
          walletProbeStatus: walletProbeResult.status,
          walletProbeBody: walletProbeResult.body || "",
          indexerTrustCount: indexerProbeResult.trustsCount,
          indexerRoles: indexerProbeResult.newEntityRoles,
          isNewTrust: !!route.isNewTrust,
          isTrustRedirect: !!route.isTrustRedirect,
          isTrustDirect: !!route.isTrustDirect,
          redirectEntityId: REDIRECT_ENTITY_ID,
          redirectTrustAddr: REDIRECT_TRUST_ADDR,
          serverRedirectStatus: serverRedirectProbe.status,
          serverRedirectLocation: serverRedirectProbe.location,
        },
      );
      antiPatterns = antiPatterns.concat(v12Issues);
    } catch (e) {
      console.warn(`  v12 checks eval error on ${route.label}: ${e.message}`);
    }

  } catch (err) {
    console.error(`  ERROR on ${route.label}: ${err.message}`);
    consoleErrors.push(`NAV_ERROR: ${err.message}`);
  } finally {
    await page.close();
  }

  return {
    label: route.label,
    url: route.url,
    finalUrl,
    auth: route.auth,
    isNewTrust: !!route.isNewTrust,
    isTrustRedirect: !!route.isTrustRedirect,
    isTrustDirect: !!route.isTrustDirect,
    httpStatus,
    elapsed: Date.now() - t0,
    fcpMs,
    screenshotPath,
    networkFailures,
    consoleErrors,
    antiPatterns,
    bodyTextSample,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  const publicCtx = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 } });
  const authedCtx = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 } });

  await authedCtx.addCookies([{
    name: "aeqi_token",
    value: TOKEN,
    domain: "app.aeqi.ai",
    path: "/",
    httpOnly: false,
    secure: true,
    sameSite: "Lax",
  }]);

  const setupPage = await authedCtx.newPage();
  try {
    await setupPage.goto("https://app.aeqi.ai/", { waitUntil: "commit", timeout: 15000 });
    await setupPage.evaluate((t) => { localStorage.setItem("aeqi_token", t); }, TOKEN);
  } catch (_) {}
  await setupPage.close();

  const results = [];
  for (const route of ROUTES) {
    const tag = route.isTrustRedirect ? " [TRUST-REDIRECT]" : route.isTrustDirect ? " [TRUST-DIRECT]" : route.isNewTrust ? " [NEW-TRUST]" : "";
    console.log(`\n[${route.label}] ${route.url}${tag}`);
    const ctx = route.auth ? authedCtx : publicCtx;
    const result = await visitRoute(ctx, route, walletProbeResult, indexerProbe, serverRedirectProbe);
    results.push(result);
    const apCount = result.antiPatterns.filter((a) => a.severity !== "info").length;
    const infoCount = result.antiPatterns.filter((a) => a.severity === "info").length;
    console.log(
      `  status=${result.httpStatus} fcp=${result.fcpMs ?? "?"}ms errors=${result.consoleErrors.length} netfails=${result.networkFailures.length} issues=${apCount} info=${infoCount}`,
    );
    for (const ap of result.antiPatterns) {
      if (ap.severity !== "info") {
        console.log(`    [${ap.severity}] ${ap.code}: ${ap.detail}`);
      } else {
        console.log(`    [info] ${ap.code}: ${ap.detail}`);
      }
    }
    if (result.consoleErrors.length > 0) {
      for (const e of result.consoleErrors.slice(0, 3)) {
        console.log(`    console.error: ${e.slice(0, 120)}`);
      }
    }
    if (result.networkFailures.length > 0) {
      for (const f of result.networkFailures.slice(0, 3)) {
        console.log(`    net-fail: ${f.status} ${f.url.slice(0, 80)}`);
      }
    }
  }

  await browser.close();
  writeFileSync(RAW_JSON, JSON.stringify(results, null, 2));
  console.log(`\nRaw JSON: ${RAW_JSON}`);
  return results;
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
