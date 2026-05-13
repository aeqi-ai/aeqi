# Security Policy

`aeqi-solana` is pre-audit protocol code. Treat every deployed build as
experimental until an audit report and matching verifiable-build hash are
published for the exact commit in use.

## Reporting

Report suspected vulnerabilities privately to:

- security@aeqi.ai

Include:

- affected program ID or local program name
- commit hash
- cluster or localnet reproduction details
- transaction signature, if available
- minimal reproduction steps

Do not open public issues for exploitable vulnerabilities.

## Response Target

Until a formal bounty program exists, the maintainer target is:

- acknowledge valid reports within 72 hours
- share the expected remediation path once impact is understood
- publish remediation notes after the fix is safe to disclose

## Supported Scope

Security reports are in scope for:

- programs under `programs/`
- factory/module initialization flows
- governance vote and execution semantics
- role authority and delegation checks
- token, treasury, budget, funding, fund, vesting, and Unifutures accounting
- generated IDLs and client instruction builders once published

Out of scope:

- local validator setup issues without protocol impact
- third-party dependency CVEs without a reachable protocol path
- UI-only issues outside the Solana transaction/auth boundary

## Release Bar

A release candidate is not considered production-ready unless:

- `npm run verify:ci` passes
- `anchor build` succeeds
- built program artifacts are recorded
- deployed program hashes are compared with deterministic build hashes
- any audit findings for the target commit are linked from `audits/README.md`

## Disclosure

Public disclosure should wait until funds or privileged state cannot be
exploited by the reported issue. If a report affects a deployed program, the
release record in `docs/deployments.md` must identify the fixed commit and the
upgrade or immutability state.
