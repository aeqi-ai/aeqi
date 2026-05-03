#!/usr/bin/env bash
# Run the dev `aeqi` binary against an isolated $HOME and a neutral cwd.
#
# Why this exists: `aeqi setup` enters workspace mode when cwd contains
# Cargo.toml / .git / agents/ / config/, which means a one-off test from
# the repo root writes seed agent files INTO the worktree. The fix is
# always `env -C $tmp HOME=$tmp ...`, but reaching for the bare
# `HOME=$tmp ...` form has burned us twice. This script makes the right
# thing as short as the wrong thing.
#
# Usage:
#   scripts/dev-isolated-aeqi.sh setup --runtime ollama_agent
#   scripts/dev-isolated-aeqi.sh start --bind 127.0.0.1:18403
#   scripts/dev-isolated-aeqi.sh doctor --strict
#
# By default the script:
#   - builds the debug binary if it doesn't exist
#   - creates a fresh tempdir HOME and a separate neutral CWD
#   - leaves the tempdir behind on exit so you can inspect it
#     (path printed to stderr); pass AEQI_KEEP=0 to clean up
#
# Env overrides:
#   AEQI_BIN     — absolute path to a prebuilt aeqi binary
#   AEQI_KEEP    — `0` to remove the temp HOME on exit (default: keep)
#   AEQI_TMP     — reuse a specific tempdir (skips mktemp)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ -n "${AEQI_BIN:-}" ]; then
    case "$AEQI_BIN" in
        /*) ;;
        *) AEQI_BIN="$(cd "$(dirname "$AEQI_BIN")" && pwd)/$(basename "$AEQI_BIN")" ;;
    esac
elif [ -x "$REPO_ROOT/target/debug/aeqi" ]; then
    AEQI_BIN="$REPO_ROOT/target/debug/aeqi"
else
    echo "[dev-isolated] building debug binary (cargo build -p aeqi)" >&2
    (cd "$REPO_ROOT" && cargo build -p aeqi)
    AEQI_BIN="$REPO_ROOT/target/debug/aeqi"
fi

if [ -n "${AEQI_TMP:-}" ]; then
    TMP="$AEQI_TMP"
    mkdir -p "$TMP"
else
    TMP="$(mktemp -d -t aeqi-dev-XXXXXX)"
fi

if [ "${AEQI_KEEP:-1}" = "0" ]; then
    trap 'rm -rf "$TMP"' EXIT INT TERM
fi

mkdir -p "$TMP/work"
echo "[dev-isolated] HOME=$TMP" >&2
echo "[dev-isolated] cwd =$TMP/work" >&2
echo "[dev-isolated] aeqi=$AEQI_BIN" >&2

exec env -C "$TMP/work" \
    HOME="$TMP" \
    XDG_CONFIG_HOME="$TMP/.config" \
    XDG_DATA_HOME="$TMP/.local/share" \
    "$AEQI_BIN" "$@"
