#!/usr/bin/env bash
# Validate the tag/version/changelog contract before release artifacts build.
#
# Usage:
#   scripts/release-preflight.sh v0.68.0
#
# In GitHub Actions the tag can also be supplied by GITHUB_REF_NAME.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TAG="${1:-${GITHUB_REF_NAME:-}}"
if [ -z "$TAG" ]; then
    TAG="$(git describe --tags --exact-match HEAD 2>/dev/null || true)"
fi

if [ -z "$TAG" ]; then
    echo "error: release tag is required (pass vX.Y.Z or set GITHUB_REF_NAME)" >&2
    exit 1
fi

if [[ ! "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "error: release tag must look like vX.Y.Z, got: $TAG" >&2
    exit 1
fi

VERSION="${TAG#v}"

CARGO_VERSION="$(
    awk '
        /^\[workspace\.package\]/ { in_workspace_package = 1; next }
        /^\[/ { in_workspace_package = 0 }
        in_workspace_package && /^version = / {
            gsub(/"/, "", $3)
            print $3
            exit
        }
    ' Cargo.toml
)"

if [ -z "$CARGO_VERSION" ]; then
    echo "error: could not read [workspace.package] version from Cargo.toml" >&2
    exit 1
fi

if [ "$CARGO_VERSION" != "$VERSION" ]; then
    echo "error: tag/version mismatch" >&2
    echo "  tag:              $TAG" >&2
    echo "  Cargo.toml:       $CARGO_VERSION" >&2
    echo "  expected version: $VERSION" >&2
    exit 1
fi

BAD_INTERNAL_DEPS="$(
    grep -nE 'aeqi-[a-z0-9-]+ = \{ version = "' Cargo.toml \
        | grep -vF "version = \"$VERSION\"" || true
)"
if [ -n "$BAD_INTERNAL_DEPS" ]; then
    echo "error: internal workspace dependency versions must match $VERSION" >&2
    echo "$BAD_INTERNAL_DEPS" >&2
    exit 1
fi

if ! grep -Eq "^## \[$VERSION\] - [0-9]{4}-[0-9]{2}-[0-9]{2}$" CHANGELOG.md; then
    echo "error: CHANGELOG.md is missing a release header for $VERSION" >&2
    echo "  expected: ## [$VERSION] - YYYY-MM-DD" >&2
    exit 1
fi

echo "release preflight OK: $TAG matches Cargo.toml and CHANGELOG.md"
