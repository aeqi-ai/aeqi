# Changelog

All notable changes to aeqi are documented here. The project uses the
workspace version in `Cargo.toml` and follows semantic versioning while the
public API is stabilizing.

## [Unreleased]

### Added

- Release preflight now checks tag, workspace package version, internal
  workspace dependency versions, and changelog coverage before release
  artifacts build.

## [0.15.0] - 2026-05-04

### Added

- Role primitives for company org charts, grants, invitations, and role-scoped
  dashboard surfaces.
- Blueprint spawn improvements, including seeded inbox messages and a smaller
  default blueprint catalog.
- Runtime support for hosted scope tokens while preserving local/self-host
  execution paths.

### Changed

- Dashboard navigation now treats company-scoped runtime surfaces as first-class:
  agents, roles, ownership, treasury, governance, quests, ideas, events, and
  sessions.
- Default starter models moved to lower-cost hosted model options where
  configured.
- Public docs, contribution guidance, and release packaging were tightened for
  first-time users.

### Fixed

- Fresh database startup no longer fails when optional channel tables have not
  been created yet.
- Blueprint spawn and billing/provisioning paths are idempotent across retries.
- The dashboard no longer assumes hosted account APIs when running in local
  runtime mode.

## [0.14.0] - 2026-04-28

### Added

- Entity/company scoping across the runtime and dashboard.
- Public changelog, security policy, and contribution guide.

### Changed

- Sidebar and dashboard routing were reorganized around company-scoped runtime
  surfaces.
- Deploy smoke checks were expanded to cover authenticated runtime paths.

## [0.13.0] - 2026-04-25

### Added

- Slack and Notion tool packs.
- Inbox capability, agent-scoped integration status, and improved question
  routing.

## [0.12.0] - 2026-04-25

### Added

- Google Workspace and GitHub tool packs.
- MCP client integration in the daemon and session manager.
- Initial integrations panel in the dashboard.

## [0.10.0] - 2026-04-25

### Changed

- Connection vocabulary collapsed to mention, embed, and link relations.
- Session transcript search added with SQLite FTS.

## [0.9.0] - 2026-04-25

### Added

- Tag policy controls for blast radius, deduplication, and supersession.
- Event invocation outcome scoring.
- Provider routing safeguards for empty upstream responses.

## [0.8.0] - 2026-04-24

### Changed

- Sessions were simplified to one execution per spawn with pending-message
  injection at step boundaries.
- Combobox and popover UI primitives were introduced.

## [0.7.0] - 2026-04-20

### Added

- Truthful event streaming for fired events and stopped sessions.
- Early dashboard design-token convergence.

## [0.6.0] - 2026-04-19

### Changed

- Tool calls and event-fired actions were unified behind one tool registry.
- Context compression became delegation-aware.
- Middleware detection moved to event patterns.
