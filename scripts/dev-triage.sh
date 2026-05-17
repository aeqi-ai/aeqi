#!/usr/bin/env bash
# Read-only local development triage for AEQI checkouts.
#
# Prints clean main status, all worktrees, dirty diff summaries, untracked files,
# and active deploy/build processes. This should be safe to run before choosing
# a quest, shipping, or cleaning up a worktree.
set -euo pipefail

ROOT="${AEQI_WORKSPACE_ROOT:-$HOME}"
REPOS=(
  "$ROOT/aeqi"
  "$ROOT/aeqi-platform"
  "$ROOT/aeqi-landing"
  "$ROOT/aeqi-docs"
)

section() {
  printf '\n== %s ==\n' "$1"
}

repo_exists() {
  [ -d "$1/.git" ] || [ -f "$1/.git" ]
}

section "main checkouts"
for repo in "${REPOS[@]}"; do
  repo_exists "$repo" || continue
  printf '\n-- %s --\n' "$repo"
  git -C "$repo" status --short --branch
  git -C "$repo" log --oneline --decorate --max-count=1
done

section "worktrees"
for repo in "${REPOS[@]}"; do
  repo_exists "$repo" || continue
  git -C "$repo" worktree list
done | sort -u

section "dirty worktree details"
found_dirty=false
while IFS= read -r wt; do
  [ -n "$wt" ] || continue
  if [ -n "$(git -C "$wt" status --short)" ]; then
    found_dirty=true
    printf '\n-- %s --\n' "$wt"
    git -C "$wt" status --short --branch
    git -C "$wt" diff --stat
    untracked=$(git -C "$wt" ls-files --others --exclude-standard)
    if [ -n "$untracked" ]; then
      printf 'untracked:\n%s\n' "$untracked"
    fi
  fi
done < <(
  for repo in "${REPOS[@]}"; do
    repo_exists "$repo" || continue
    git -C "$repo" worktree list --porcelain | awk '/^worktree / {print $2}'
  done | sort -u
)

if [ "$found_dirty" = false ]; then
  echo "No dirty git worktrees found."
fi

section "active deploy/build processes"
pgrep -af "$ROOT/aeqi/[s]cripts/deploy.sh|$ROOT/aeqi/[s]cripts/ui-deploy.sh|$ROOT/aeqi-platform/[d]eploy/deploy.sh|cargo build --release|vite --host|solana-test-validator" || \
  echo "No matching deploy/build processes."
