# Audit Status

No external audit has been completed for this Solana codebase yet.

This directory is the canonical place for:

- audit reports
- formal verification reports
- remediation notes
- final audited commit hashes
- verifiable-build hash records

## Current State

- Status: pre-audit
- Canonical verification command: `npm run verify:ci`
- Build command: `anchor build`
- Hash helper: `npm run verify:hashes`

## Before an Audit

The codebase should have:

- no placeholder `Skeleton` or `follow-up` execution paths in shipped programs
- explicit invariant checks for critical mutable accounts
- adversarial tests for authorization, stale state, replay, PDA spoofing, and arithmetic bounds
- deterministic build instructions in `docs/verifiable-build.md`
- release checklist in `docs/release-checklist.md`
- deployment/program-ID record in `docs/deployments.md`
- a final frozen commit hash for the auditor

## After an Audit

Each audit entry should include:

- auditor
- report filename
- audited commit hash
- deployed program IDs, if any
- remediation commit hash
- unresolved findings and accepted risks
