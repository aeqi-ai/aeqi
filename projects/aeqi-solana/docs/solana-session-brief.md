# AEQI Solana Session Brief

Use this file to start a fresh session on the Solana protocol work.

## Current State

- The Solana protocol stack is the canonical implementation target.
- Governance is now explicit about loading config from `remaining_accounts`.
- The full Anchor suite passed on the last run: `97 passing`.
- Anchor macro warning noise is intentionally suppressed at crate boundaries so
  real protocol warnings surface cleanly.

## Last Verified Changes

- `aeqi_governance`
  - `propose` and `execute_proposal` now validate config via a shared loader.
  - the loader checks PDA address, owner, Anchor discriminator, embedded trust,
    and `governance_config_id`.
  - config mismatches surface as `ConfigMismatch`.
  - generic caller-supplied vote weights are disabled with
    `GenericVotingDisabled`; proposal tests now use typed token voting for real
    tally setup.
- Tests
  - `tests/aeqi-governance.ts` migrated to `remainingAccounts` for config passing.
  - `tests/aeqi-end-to-end.ts` migrated to the same governance account shape.
  - the brittle config-mismatch test was fixed by registering the config first.
  - missing config `remainingAccounts` are covered on both `propose` and
    `execute_proposal`.
  - Rust loader tests cover wrong discriminator, truncated body, and embedded
    trust mismatch.
- `aeqi_token`
  - token CPI entrypoints now require the Token-2022 program explicitly.
  - `create_mint` rejects the legacy SPL Token program with `InvalidTokenProgram`.
  - `mint_tokens` now requires a real `aeqi_trust::Trust` account, verifies the
    token module is bound to that TRUST, and requires the TRUST authority signer
    before the program PDA mints cap-table tokens.
- `aeqi_role`
  - `create_role` no longer permits arbitrary child-role creation without an
    occupied caller role.
  - root-role bootstrap without `caller_role` is limited to the first role for
    that role type.
  - caller roles must be occupied, held by the payer, and bound to the same
    trust before their authority walk can create child roles.

## What To Work On Next

1. Fix budget/fund/funding accounting invariants: quote-mint binding, spend
   authority, budget-backed funding activation, and creator/trust activation
   checks.
2. Gate `aeqi_role::assign_role` behind the same occupied-role authority walk
   now used by child-role creation.
3. Replace the temporary TRUST-authority mint bridge with a governance/module
   ACL mint execution path once proposal execution is wired to module actions.
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

> Continue Solana protocol hardening from the current green state. Keep the work
> file-by-file, preserve behavior, and close the next authority/accounting gap
> with an adversarial test before moving on.
