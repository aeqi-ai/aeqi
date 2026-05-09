# Monorepo consolidation — aeqi-core → aeqi/contracts/

**Status:** Procedure decided 2026-05-04. Execution scheduled 3-5 days post bridge-verification.
**Owner:** runtime team.
**Companion docs:**
- `aeqi-economy-plan.md` § workstreams table — WS-8 monorepo consolidation
- `aeqi-core/CLAUDE.md` — contract architecture, file naming, cross-repo coupling

---

## Decision

aeqi-core (`/home/claudedev/projects/aeqi-core/`) gets folded into the aeqi monorepo as `aeqi/contracts/`. The cost we keep paying today is cross-repo drift: indexer ABIs go stale silently, the dao_provisioner's alloy bindings drift from contract source, foundry CI lives in a second-class location. One commit that updates contract + ABI + indexer reader + provisioner binding is the right shape. Subversion enables audit shops to extract `contracts-snapshot` on demand; no tooling cost.

---

## Pre-conditions (gates BEFORE running this procedure)

All must hold:

- [ ] Click→DAO bridge verified end-to-end with at least one real Company creation through the wizard (WS-2 + WS-1 + WS-9 must have shipped)
- [ ] No active aeqi-core PRs or worktrees (clean state)
- [ ] aeqi-platform's `dao_provisioner.rs` is stable (not actively being refactored)
- [ ] WS-4 contract changes have NOT yet started

If any gate fails, abort and reschedule. Gates protect the merge window from becoming a live project collision.

---

## Step-by-step procedure

### Step 1: Snapshot aeqi-core (current state)

Document the SHA being consolidated. Tag aeqi-core's main with `pre-consolidation-<date>` for forensic recovery.

```bash
cd /home/claudedev/projects/aeqi-core
git tag pre-consolidation-$(date +%Y-%m-%d) origin/main
git push origin pre-consolidation-$(date +%Y-%m-%d)
```

Record the snapshot commit in the merge PR description.

### Step 2: Subtree-add into aeqi/contracts/

Create a consolidation worktree. Use `git subtree add --squash` to fold aeqi-core's entire tree into `aeqi/contracts/` as a single commit.

```bash
cd /home/claudedev/aeqi
git fetch origin
git worktree add /home/claudedev/aeqi-consolidate -b ws-8/monorepo-consolidation origin/main
cd /home/claudedev/aeqi-consolidate

git subtree add --prefix=contracts \
  /home/claudedev/projects/aeqi-core main --squash
```

Result: `aeqi/contracts/` directory containing all aeqi-core content (contracts/, lib/, scripts/foundry/, test/, foundry.toml, remappings.txt, Makefile, audits/, foundry.lock, .gas-snapshot, .github/ if any). One squash commit lands on aeqi's branch.

### Step 3: Update aeqi-platform cross-repo paths

Search aeqi-platform/src/ for hard-coded references to `/home/claudedev/projects/aeqi-core` or sibling-repo paths. Update to point at `/home/claudedev/aeqi/contracts/`:

- `aeqi-platform/src/dao_provisioner.rs` — uses alloy `sol!` inline. Verify no path literals. If found, update.
- `aeqi-platform/deploy/deploy.sh` — confirm contract artifacts (if any) point at the new location.
- `aeqi-platform/CLAUDE.md` § "cross-repo coupling" — update the path.

The `sol!` macro doesn't require rebuild after a physical path move (it inlines the ABI at compile time), so this step is mostly hygiene + documentation.

### Step 4: Update aeqi-indexer ABI source

`aeqi/crates/aeqi-indexer/abis/*.json` are committed copies of contract ABIs. Add a Make target in the aeqi root that regenerates them from the contracts directory:

```makefile
.PHONY: abis
abis:
	cd contracts && forge inspect Factory abi > ../crates/aeqi-indexer/abis/Factory.json
	cd contracts && forge inspect TRUST abi > ../crates/aeqi-indexer/abis/TRUST.json
	cd contracts && forge inspect Beacon abi > ../crates/aeqi-indexer/abis/Beacon.json
	cd contracts && forge inspect RoleModule abi > ../crates/aeqi-indexer/abis/RoleModule.json
	cd contracts && forge inspect TokenModule abi > ../crates/aeqi-indexer/abis/TokenModule.json
	# ... repeat for every ABI the indexer watches
```

Add a CI gate (GitHub Actions or local pre-commit) that runs `make abis` and asserts `git diff --exit-code crates/aeqi-indexer/abis/`. Drift becomes a build failure, not a silent skew.

### Step 5: Update top-level CLAUDE.md

Add a section on `contracts/` to `aeqi/CLAUDE.md`:

```markdown
## Foundry / contracts/

Contracts live at `aeqi/contracts/`. Build and test commands run from that directory:

\`\`\`bash
cd contracts && forge build
cd contracts && forge test
cd contracts && forge fmt
\`\`\`

Cargo operations run from the aeqi root (workspace mode). They do not conflict — different build roots, lockfiles, toolchains.

**ABI regeneration:** After any contract change that affects an indexed event (Factory, TRUST, or any module), regenerate ABIs:

\`\`\`bash
make abis
\`\`\`

Commit the updated `.json` files alongside the contract changes.
```

### Step 6: Update GitHub Actions CI

aeqi's `.github/workflows/ci.yml` gains a `forge` job that runs in parallel with the Rust and UI jobs:

```yaml
forge:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
      with:
        submodules: recursive
    - uses: foundry-rs/foundry-toolchain@v1
    - run: cd contracts && forge build --sizes
    - run: cd contracts && forge test --no-match-test 'test_GetAddressKey'
    - run: cd contracts && forge snapshot --check --no-match-test 'test_GetAddressKey'
    - run: make abis-check
```

Add an `abis-check` target to the Makefile:

```makefile
.PHONY: abis-check
abis-check:
	cd contracts && forge inspect Factory abi > /tmp/Factory.json
	@diff -q crates/aeqi-indexer/abis/Factory.json /tmp/Factory.json || \
		(echo "ABIs out of sync. Run 'make abis' and commit."; exit 1)
	# ... repeat for other ABIs
```

This ensures contract changes don't drift the indexer without explicit regeneration.

### Step 7: Update /ship skill

The `/ship` skill's repo detection and verification logic needs updating. In `~/.claude/skills/ship/SKILL.md`:

- Remove the `/home/claudedev/projects/aeqi-core-*` worktree path arm from the repo-detection table.
- Update aeqi's verify step: when `contracts/**` files are detected as changed, ALSO run `cd contracts && forge build && cd contracts && forge test --no-match-test 'test_GetAddressKey'` in parallel with the Rust/UI suite.
- Drop aeqi-core-specific failure modes from the debug section.

This ensures the ship cycle treats contract changes with the same rigor as platform changes.

### Step 8: Archive aeqi-core on GitHub

GitHub repository settings:

1. Archive the `aeqi-ai/aeqi-core` repository as read-only.
2. Add a README banner pointing at `https://github.com/aeqi-ai/aeqi/tree/main/contracts`.
3. Lock branch protections so accidental pushes fail.

Local cleanup:

```bash
cd /home/claudedev/projects/aeqi-core
git remote remove origin
```

Keeps the directory for forensic reference (the `pre-consolidation-*` tag is in the local reflog), but prevents accidental commits from pushing.

### Step 9: Full verify gauntlet

On the consolidation worktree, run the complete suite in sequence:

```bash
cd /home/claudedev/aeqi-consolidate

# Contracts
cd contracts && forge build && forge test

# Rust
cd .. && cargo fmt && cargo clippy --workspace -- -D warnings && cargo test --workspace

# UI
cd apps/ui && npx tsc --noEmit && npx prettier --check "src/**/*.{ts,tsx,css}"

# Drift check
make abis-check
```

All four gates must pass clean. No exceptions.

### Step 10: Merge and ship

Commit the consolidation branch:

```bash
git commit -m "$(cat <<'EOF'
chore: fold aeqi-core into contracts/

Move all aeqi-core contracts, tests, scripts, and foundry config into aeqi/contracts/.
Add Make targets for ABI regeneration and CI gate for drift detection. Archive aeqi-core
repo on GitHub. Indexer ABI regeneration now a single command; contract + provisioner +
indexer stay synchronized on every merge.

Snapshot SHA recorded: [pre-consolidation tag from Step 1]

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"

git push origin ws-8/monorepo-consolidation
```

Open a PR, verify CI passes (all three jobs: forge, rust, ui), then merge via `/ship`.

Post-deploy: confirm `curl -sL https://app.aeqi.ai/api/health` returns 200. Tag `monorepo-consolidation-<date>` on the shipped commit.

---

## Audit posture

Audit shops sometimes prefer a clean, contracts-only repository with no extraneous platform code. Workaround: branch a `contracts-snapshot` subtree at audit time.

```bash
cd /home/claudedev/aeqi
git subtree split --prefix=contracts --branch contracts-snapshot
git push origin contracts-snapshot --set-upstream
```

Push to a fresh `aeqi-contracts-audit` GitHub repository. Auditor sees pristine contracts only; aeqi monorepo continues unchanged for daily work.

---

## What stays separate

- **aeqi-platform** — half-coupled to aeqi via deploy.sh. Consolidating is a bigger refactor (cross-repo serde, test fixtures). Defer to a future wave.
- **aeqi-landing** — different brand surface, different deploy target. Stays separate.
- **aeqi-docs** — content-only, separate repo.

These are out of scope for this consolidation.

---

## Rollback

If anything in the merge breaks the runtime stack or indexer:

```bash
git -C /home/claudedev/aeqi reset --hard <pre-consolidation SHA>
git -C /home/claudedev/aeqi push --force-with-lease origin main
```

The `pre-consolidation-*` tag in aeqi-core's GitHub (from Step 8) documents the exact state. Un-archive the aeqi-core GitHub repo if needed. Resume separate-repo workflow.

Total recovery time: ~10 minutes.

---

## Decision authority

This procedure is architecturally decided. Execution-time judgment calls (exact Make target granularity, specific ABI regeneration scope, CI job parallelization order) are owner-discretion within the bounds of this procedure.
