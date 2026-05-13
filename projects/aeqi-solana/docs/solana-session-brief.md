# AEQI Solana Session Brief

Use this file to start a fresh session on the Solana protocol work.

## Current State

- The Solana protocol stack is the canonical implementation target.
- Governance is now explicit about loading config from `remaining_accounts`.
- The full Anchor suite passed on the last run: `92 passing`.
- The current repo still has framework noise, but the functional test suite is green.

## Last Verified Changes

- `aeqi_governance`
  - `propose` and `execute_proposal` now validate config via a shared loader.
  - config mismatches surface as `ConfigMismatch`.
- Tests
  - `tests/aeqi-governance.ts` migrated to `remainingAccounts` for config passing.
  - `tests/aeqi-end-to-end.ts` migrated to the same governance account shape.
  - the brittle config-mismatch test was fixed by registering the config first.

## What To Work On Next

1. Reduce Anchor warning noise crate by crate.
2. Tighten trust / factory / governance invariants if any new drift appears.
3. Add more adversarial tests only where they compound coverage.
4. Keep the Solana code readable and audit-friendly.

## Working Rules

- Change one file at a time unless a paired test file must move with it.
- Preserve behavior unless the change is explicitly about behavior.
- Prefer explicit accounts and explicit errors over hidden framework behavior.
- Fix harness drift before treating a failure as protocol logic.
- Do not reintroduce EVM-style proxy/beacon mental models into the Solana path.

## Canonical Commands

- `npm test`
- `cargo test -q -p aeqi-governance --lib`
- `cargo fmt --all`
- `cargo clippy --all-targets --all-features`

## Suggested Opening Prompt

> Continue Solana protocol hardening from the current green state. Keep the work file-by-file, preserve behavior, and focus first on reducing Anchor warning noise while keeping trust, factory, governance, token, and Unifutures explicit and auditable.

