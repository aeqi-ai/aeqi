#!/usr/bin/env node
// Bundle perf regression gate.
//
// Reads `dist/` after a vite build, captures per-chunk gzipped sizes,
// compares to `bench/perf-baseline.json`. Fails if any tracked chunk grew
// >10% (REGRESSION_PCT) or any new chunk exceeds NEW_CHUNK_FLOOR_KB.
//
// Manual invocations:
//   npm run perf:check               # diff vs baseline
//   npm run perf:update-baseline     # rewrite baseline from current dist
//
// Not wired into `npm run verify` yet — let baseline settle across a few
// ships before turning it into a gate.

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_ROOT = dirname(__dirname);
const DIST_ASSETS = join(UI_ROOT, "dist", "assets");
const BASELINE_PATH = join(UI_ROOT, "bench", "perf-baseline.json");
const BENCH_DIR = dirname(BASELINE_PATH);

const REGRESSION_PCT = 10;
const NEW_CHUNK_FLOOR_KB = 50; // a new chunk over this gz size needs review

/**
 * Capture {name → {bytes, gz}} for every JS chunk in `dist/assets/`.
 * Strips the Vite content-hash so chunk identity is stable across builds.
 */
function captureChunks() {
  let entries;
  try {
    entries = readdirSync(DIST_ASSETS);
  } catch {
    console.error(`[perf-baseline] dist/assets not found. Run \`npm run build\` first.`);
    process.exit(2);
  }
  const chunks = {};
  for (const name of entries) {
    if (!name.endsWith(".js")) continue;
    const full = join(DIST_ASSETS, name);
    const raw = readFileSync(full);
    const bytes = statSync(full).size;
    const gz = gzipSync(raw).length;
    // Strip Vite content-hash: `wallet-metamask-sdk-DSG8DSGQ.js` →
    // `wallet-metamask-sdk.js`. Vite's default hash is EXACTLY 8 chars
    // from `[A-Za-z0-9_-]` (yes — hyphens inside hashes happen, see
    // `index-CH1L-JOO.js`). Anchoring on `{8}` rather than `{8,}` keeps
    // the meaningful chunk name intact when it contains its own hyphens
    // (locale bundles like `en_US-Y4ZOVFV4-<hash>.js` preserve the
    // locale-id segment).
    const stable = name.replace(/-[A-Za-z0-9_-]{8}\.js$/, ".js");
    if (chunks[stable]) {
      // Two chunks collapse to the same stable name (shouldn't happen
      // with vite's manualChunks setup but defensive). Pick the bigger.
      if (bytes > chunks[stable].bytes) chunks[stable] = { bytes, gz };
    } else {
      chunks[stable] = { bytes, gz };
    }
  }
  return chunks;
}

function format(n) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${n} B`;
}

function diff(baseline, current) {
  const regressions = [];
  const newChunks = [];
  const removed = [];
  const improvements = [];
  for (const [name, b] of Object.entries(baseline.chunks)) {
    const c = current[name];
    if (!c) {
      removed.push({ name, was: b.gz });
      continue;
    }
    const pct = ((c.gz - b.gz) / b.gz) * 100;
    if (c.gz > b.gz && pct > REGRESSION_PCT) {
      regressions.push({ name, before: b.gz, after: c.gz, pct });
    } else if (c.gz < b.gz && pct < -5) {
      improvements.push({ name, before: b.gz, after: c.gz, pct });
    }
  }
  for (const [name, c] of Object.entries(current)) {
    if (!baseline.chunks[name]) {
      newChunks.push({ name, gz: c.gz });
    }
  }
  return { regressions, newChunks, removed, improvements };
}

function main() {
  const updateBaseline = process.argv.includes("--update-baseline");
  const current = captureChunks();
  const currentTotal = Object.values(current).reduce((a, c) => a + c.gz, 0);
  const currentRaw = Object.values(current).reduce((a, c) => a + c.bytes, 0);

  if (updateBaseline) {
    const out = {
      _comment:
        "Per-chunk gzipped sizes after vite build. Stable names (Vite content-hash stripped). Regenerate with `npm run perf:update-baseline` after a deliberate code-split or dependency shift.",
      capturedAt: new Date().toISOString().slice(0, 10),
      totalGz: currentTotal,
      totalRaw: currentRaw,
      regressionPct: REGRESSION_PCT,
      newChunkFloorKb: NEW_CHUNK_FLOOR_KB,
      chunks: Object.fromEntries(
        Object.entries(current)
          .sort((a, b) => b[1].gz - a[1].gz)
          .map(([n, v]) => [n, v]),
      ),
    };
    try {
      readdirSync(BENCH_DIR);
    } catch {
      // mkdir -p — the bench dir may not exist on first run.
      mkdirSync(BENCH_DIR, { recursive: true });
    }
    writeFileSync(BASELINE_PATH, JSON.stringify(out, null, 2) + "\n");
    console.log(
      `[perf-baseline] wrote ${BASELINE_PATH} (${Object.keys(current).length} chunks, ${format(currentTotal)} gz)`,
    );
    return;
  }

  let baseline;
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    console.log(
      `[perf-baseline] no baseline at ${BASELINE_PATH} — run \`npm run perf:update-baseline\` to lock current sizes`,
    );
    console.log(`[perf-baseline] current: ${Object.keys(current).length} chunks, ${format(currentTotal)} gz`);
    process.exit(0);
  }

  const { regressions, newChunks, removed, improvements } = diff(baseline, current);
  const totalDelta = currentTotal - baseline.totalGz;
  const totalPct = (totalDelta / baseline.totalGz) * 100;

  console.log(`[perf-baseline] total gz: ${format(currentTotal)} (${totalPct >= 0 ? "+" : ""}${totalPct.toFixed(1)}% vs baseline)`);

  if (improvements.length > 0) {
    console.log("");
    console.log("Improvements:");
    for (const i of improvements) {
      console.log(`  ✓ ${i.name}: ${format(i.before)} → ${format(i.after)} (${i.pct.toFixed(1)}%)`);
    }
  }

  if (removed.length > 0) {
    console.log("");
    console.log("Removed chunks (no longer in build):");
    for (const r of removed) {
      console.log(`  · ${r.name} (was ${format(r.was)} gz)`);
    }
  }

  let exit = 0;

  const bigNewChunks = newChunks.filter((c) => c.gz >= NEW_CHUNK_FLOOR_KB * 1024);
  if (bigNewChunks.length > 0) {
    console.log("");
    console.log(`! New chunks over ${NEW_CHUNK_FLOOR_KB}kB gz — needs review:`);
    for (const c of bigNewChunks) {
      console.log(`  ! ${c.name}: ${format(c.gz)} gz`);
    }
    exit = 1;
  }

  if (regressions.length > 0) {
    console.log("");
    console.log(`! Regressions over ${REGRESSION_PCT}%:`);
    for (const r of regressions) {
      console.log(`  ✗ ${r.name}: ${format(r.before)} → ${format(r.after)} (+${r.pct.toFixed(1)}%)`);
    }
    exit = 1;
  }

  if (exit === 0) {
    console.log("[perf-baseline] no regressions.");
  } else {
    console.log("");
    console.log("If the growth is intentional (new feature, dependency upgrade), run:");
    console.log("  npm run perf:update-baseline");
  }
  process.exit(exit);
}

main();
