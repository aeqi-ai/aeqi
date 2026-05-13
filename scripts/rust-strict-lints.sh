#!/usr/bin/env bash
# Run the Rust lint gate that is meant to catch warnings in every compiled
# target, including tests/examples and feature-gated code.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
cd "$ROOT"

echo "=== Rust format check ==="
cargo fmt --all --check

echo "=== Rust clippy: workspace, all targets, all features ==="
cargo clippy --workspace --all-targets --all-features -- -D warnings

