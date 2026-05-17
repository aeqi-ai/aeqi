# Development Workflow

This repo is usually developed from git worktrees. Before choosing work, run:

```bash
npm run dev:triage
```

The triage helper is read-only. It reports the clean main checkouts, active
worktrees, dirty diff summaries, untracked files, and deploy/build processes.
Use it before removing a worktree or starting a ship cycle.

## Webhook Deploy Routing

The production webhook wrapper for the `aeqi` repo should delegate to:

```bash
npm run deploy:webhook
```

That script pulls `origin/main`, classifies the changed paths, and routes:

- `apps/ui/`, `packages/web-shared/`, or `packages/tokens/` changes to
  `scripts/ui-deploy.sh`.
- Rust/runtime/config-impacting changes to the host-local full deploy script.
- docs, observations, scripts, and root package metadata changes to no deploy.

To test classification without pulling or deploying:

```bash
printf 'apps/ui/src/App.tsx\n' | scripts/webhook-deploy-aeqi.sh classify
printf 'crates/aeqi-core/src/lib.rs\n' | scripts/webhook-deploy-aeqi.sh classify
```

To test a real pull path without executing the deploy step:

```bash
AEQI_DEPLOY_DRY_RUN=1 scripts/webhook-deploy-aeqi.sh
```
