#!/usr/bin/env node

import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const deployDir = new URL("../target/deploy", import.meta.url).pathname;

if (!existsSync(deployDir)) {
  console.error("target/deploy does not exist. Run `anchor build` first.");
  process.exit(1);
}

const programs = readdirSync(deployDir)
  .filter((file) => file.endsWith(".so"))
  .sort();

if (programs.length === 0) {
  console.error("No built program artifacts found in target/deploy.");
  process.exit(1);
}

console.log("Built program artifacts:");
for (const program of programs) {
  console.log(`- ${basename(program)} (${join(deployDir, program)})`);
}

console.log("");
console.log("For deployed programs, compare deterministic build hashes with:");
console.log("  solana-verify get-executable-hash target/deploy/<program>.so");
console.log("  solana-verify get-program-hash -u <cluster-url> <program-id>");
