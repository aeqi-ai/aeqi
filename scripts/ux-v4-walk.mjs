#!/usr/bin/env node
/**
 * UX Walk v4 — 2026-05-05
 * Fourth UX pass. Verifying Wave 16 shipped fixes:
 *   - pill buttons (94116b5b)
 *   - sidebar leak (47839aaa)
 *   - plan name (d243bcf7)
 *   - avatar color (230eea31)
 *   - padding tokens (fb789877)
 *   - button variants (f8c521fc)
 *   - spacing/typo normalize (51244309)
 *
 * Additional checks vs v3:
 *   - jade badges (ownership FOUNDER badge, governance 1 ROLE badge)
 *   - aeqi lowercase in agent identity text
 *   - "See proposals (full tab in Phase 2)" exposed build note
 *   - Director role UUID display
 *
 * Output:
 *   Screenshots → /home/claudedev/aeqi/.observations/ux-v4/
 *   Raw JSON   → /home/claudedev/aeqi/.observations/ux-v4/raw.json
 *
 * Usage:
 *   AEQI_WEB_SECRET=... node scripts/ux-v4-walk.mjs
 */

import { chromium } from "/home/claudedev/.npm/_npx/420ff84f11983ee5/node_modules/playwright/index.mjs";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = "/home/claudedev/aeqi";
const SCREENSHOT_DIR = join(REPO_ROOT, ".observations", "ux-v4");
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
const ENTITY_ID = "9f8d30b9-abed-408e-9eae-91c48bb360ff";
const AGENT_ID = "1b6bcf4e-79f0-4d8e-9a55-501e87149836";

const TOKEN = execSync(
  `AEQI_WEB_SECRET="${AEQI_WEB_SECRET}" node /home/claudedev/aeqi/scripts/_mint-jwt.mjs ${USER_ID} ${EMAIL} 7200`,
  { encoding: "utf-8" },
).trim();

console.log(`JWT minted: ${TOKEN.slice(0, 40)}...`);

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
  { url: `https://app.aeqi.ai/blueprints`, label: "app-blueprints", auth: true },
  { url: `https://app.aeqi.ai/economy`, label: "app-economy", auth: true },
  { url: `https://app.aeqi.ai/start`, label: "app-start", auth: true },
];

// ── Anti-pattern detector ─────────────────────────────────────────────────────
const DETECT_ANTIPATTERNS = `() => {
  const issues = [];
  const body = document.body;
  if (!body) return issues;
  const allText = body.innerText || "";

  // 1. Raw CSS variable literals
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

  // 3. AEQI uppercase
  if (/\\bAEQI\\b/.test(allText)) {
    const count = (allText.match(/\\bAEQI\\b/g) || []).length;
    issues.push({ code: "AEQI_UPPERCASE", severity: "P1",
      detail: "Uppercase AEQI " + count + "x" });
  }

  // 4. Pill buttons — ENHANCED: distinguish action vs sidebar/avatar
  const interactiveEls = Array.from(
    document.querySelectorAll("button, [role=button], a.btn, .btn")
  ).slice(0, 80);
  let actionPillCount = 0;
  let avatarPillCount = 0;
  const actionPillExamples = [];
  for (const el of interactiveEls) {
    const r = parseFloat(window.getComputedStyle(el).borderRadius);
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const text = (el.textContent || "").trim().slice(0, 30);
    if (r > 8) {
      // Heuristic: if roughly square (w ≈ h and h <= 56), likely avatar/icon
      const isIconLike = Math.abs(w - h) < 12 && h <= 56 && text.length <= 3;
      // Or if radius >= 50% of height — true pill shape on text button
      const isPill = r >= h * 0.4 && !isIconLike;
      if (isPill) {
        actionPillCount++;
        if (actionPillExamples.length < 3) {
          actionPillExamples.push(r + "px \\"" + text + "\\"");
        }
      } else {
        avatarPillCount++;
      }
    }
  }
  if (actionPillCount > 0) {
    issues.push({ code: "ACTION_PILL_BUTTONS", severity: "P1",
      detail: actionPillCount + " action pill buttons (>8px radius on text CTA). Examples: " + actionPillExamples.join("; ") });
  }
  if (avatarPillCount > 0) {
    issues.push({ code: "ICON_PILL_BUTTONS", severity: "info",
      detail: avatarPillCount + " icon/avatar circular elements (expected if circular design)" });
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

  // 10. Personal rail leak (Ownership/Governance on /me/*)
  if (window.location.pathname.startsWith("/me")) {
    const sidebarEl = document.querySelector("[class*=sidebar],[class*=rail],[class*=nav],[class*=Sidebar]");
    const sidebarText = (sidebarEl || {}).innerText || "";
    if (/Ownership|Governance/i.test(sidebarText)) {
      issues.push({ code: "PERSONAL_RAIL_LEAK", severity: "P1",
        detail: "Personal rail shows Ownership/Governance (company-only tabs)" });
    }
  }

  // 11. Jade/teal badges (should only appear for success semantics)
  //     Check for teal-ish text color on badge-like elements
  const badgeEls = Array.from(document.querySelectorAll(
    "[class*=badge],[class*=Badge],[class*=tag],[class*=Tag],[class*=chip],[class*=Chip],[class*=pill]"
  )).slice(0, 50);
  let jadeBadgeCount = 0;
  const jadeBadgeExamples = [];
  for (const el of badgeEls) {
    const s = window.getComputedStyle(el);
    // Check both text color and background color for teal/jade hue
    for (const colorProp of [s.color, s.backgroundColor]) {
      const m = colorProp.match(/rgb\\((\\d+),\\s*(\\d+),\\s*(\\d+)\\)/);
      if (m) {
        const [, r, g, b] = m.map(Number);
        // Jade/teal: G significantly higher than R and B, or G+B > 2*R in cyan range
        if (g > 120 && g > r * 1.3 && g > b * 0.8 && b > 80) {
          jadeBadgeCount++;
          if (jadeBadgeExamples.length < 3) {
            jadeBadgeExamples.push("\\"" + (el.textContent||"").trim().slice(0,20) + "\\" " + colorProp);
          }
          break;
        }
      }
    }
  }
  if (jadeBadgeCount > 0) {
    issues.push({ code: "JADE_BADGE_NON_SUCCESS", severity: "P1",
      detail: jadeBadgeCount + " badge(s) with jade/teal color outside success context. Examples: " + jadeBadgeExamples.join("; ") });
  }

  // 12. Raw UUID visible as primary text (plan name regression)
  const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const uuidMatches = allText.match(uuidPattern) || [];
  if (uuidMatches.length > 0) {
    // Only flag if in a heading/prominent position — check headings
    const headings = Array.from(document.querySelectorAll("h1,h2,h3,.heading,strong")).slice(0, 30);
    let uuidInHeading = false;
    for (const h of headings) {
      if (uuidPattern.test(h.innerText || "")) {
        uuidInHeading = true;
        uuidPattern.lastIndex = 0;
        break;
      }
      uuidPattern.lastIndex = 0;
    }
    if (uuidInHeading) {
      issues.push({ code: "UUID_AS_LABEL", severity: "P1",
        detail: "Raw UUID appears in a heading/prominent label (plan name regression?)" });
    }
  }

  // 13. "See proposals" build note in governance
  if (allText.includes("See proposals") && allText.includes("Phase 2")) {
    issues.push({ code: "BUILD_NOTE_EXPOSED", severity: "P2",
      detail: '"See proposals (full tab in Phase 2)" internal note visible on page' });
  }

  // 14. Check button radius tokens are correct (post Wave 16 fix)
  //     Action buttons should have radius between 4px-8px (not 999px, not 0)
  const actionBtns = Array.from(document.querySelectorAll("button.btn, .btn-primary, .btn-secondary, [class*=button]")).slice(0, 20);
  let correctRadiusCount = 0;
  let wrongRadiusCount = 0;
  for (const btn of actionBtns) {
    const r = parseFloat(window.getComputedStyle(btn).borderRadius);
    const text = (btn.textContent || "").trim();
    if (text.length > 2) { // text buttons only
      if (r > 8) wrongRadiusCount++;
      else correctRadiusCount++;
    }
  }
  issues.push({ code: "BUTTON_RADIUS_CHECK", severity: "info",
    detail: "Action buttons: " + correctRadiusCount + " correct radius (<= 8px), " + wrongRadiusCount + " wrong (> 8px)" });

  return issues;
}`;

// ── Core visit function ───────────────────────────────────────────────────────
async function visitRoute(context, route) {
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

    await page.waitForTimeout(2000);

    screenshotPath = join(SCREENSHOT_DIR, `${route.label}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`  screenshot: ${screenshotPath}`);

    try {
      bodyTextSample = await page.evaluate(() => (document.body.innerText || "").slice(0, 4000));
    } catch (_) {}

    try {
      antiPatterns = await page.evaluate(new Function(`return (${DETECT_ANTIPATTERNS})()`));
    } catch (e) {
      console.warn(`  anti-pattern eval error on ${route.label}: ${e.message}`);
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
    console.log(`\n[${route.label}] ${route.url}`);
    const ctx = route.auth ? authedCtx : publicCtx;
    const result = await visitRoute(ctx, route);
    results.push(result);
    const apCount = result.antiPatterns.filter(a => a.severity !== "info").length;
    const infoCount = result.antiPatterns.filter(a => a.severity === "info").length;
    console.log(`  status=${result.httpStatus} fcp=${result.fcpMs ?? "?"}ms errors=${result.consoleErrors.length} netfails=${result.networkFailures.length} issues=${apCount} info=${infoCount}`);
    for (const ap of result.antiPatterns) {
      if (ap.severity !== "info") {
        console.log(`    [${ap.severity}] ${ap.code}: ${ap.detail}`);
      } else {
        console.log(`    [info] ${ap.code}: ${ap.detail}`);
      }
    }
    if (result.consoleErrors.length > 0) {
      for (const e of result.consoleErrors.slice(0, 2)) {
        console.log(`    console.error: ${e.slice(0, 100)}`);
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
