#!/usr/bin/env bash
# Pre-dispatch coordination check for parallel AEQI coding sessions.
#
# Usage:
#   scripts/aeqi-pre-dispatch.sh <quest_id>
#   scripts/aeqi-pre-dispatch.sh --release <quest_id>
#
# The default action records a short-lived claim in ~/.aeqi/claims and prints
# the active worktree/process context that should be reviewed before work
# starts. Existing young claims block by default; pass AEQI_CLAIM_FORCE=1 only
# after verifying the owner is stale or has handed off.

set -euo pipefail

ROOT="${AEQI_WORKSPACE_ROOT:-$HOME}"
CLAIMS_DIR="${AEQI_CLAIMS_DIR:-$HOME/.aeqi/claims}"
CLAIM_TTL_SECS="${AEQI_CLAIM_TTL_SECS:-14400}"
ACTION="claim"

usage() {
  cat >&2 <<'EOF'
usage:
  scripts/aeqi-pre-dispatch.sh <quest_id>
  scripts/aeqi-pre-dispatch.sh --release <quest_id>

env:
  AEQI_CLAIM_FORCE=1       overwrite a non-expired claim after manual review
  AEQI_CLAIM_TTL_SECS=...  default 14400 seconds (4h)
  AEQI_CLAIMS_DIR=...      default ~/.aeqi/claims
EOF
}

if [ "${1:-}" = "--release" ]; then
  ACTION="release"
  shift
fi

QUEST_ID="${1:-}"
if [ -z "$QUEST_ID" ]; then
  usage
  exit 2
fi

case "$QUEST_ID" in
  *[!A-Za-z0-9._-]*)
    echo "[pre-dispatch] invalid quest id: $QUEST_ID" >&2
    exit 2
    ;;
esac

CLAIM_FILE="$CLAIMS_DIR/$QUEST_ID.claim"
LOCK_DIR="$CLAIMS_DIR/$QUEST_ID.lock"

now_epoch() {
  date +%s
}

iso_now() {
  date -Is
}

claim_age() {
  local created="$1"
  local now
  now="$(now_epoch)"
  echo $((now - created))
}

read_claim_field() {
  local key="$1"
  local file="$2"
  grep -E "^${key}=" "$file" 2>/dev/null | head -1 | cut -d= -f2- || true
}

release_claim() {
  if [ -f "$CLAIM_FILE" ]; then
    rm -f "$CLAIM_FILE"
    echo "[pre-dispatch] released $QUEST_ID"
  else
    echo "[pre-dispatch] no claim to release for $QUEST_ID"
  fi
}

acquire_lock() {
  mkdir -p "$CLAIMS_DIR"
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "[pre-dispatch] claim lock busy: $LOCK_DIR" >&2
    exit 3
  fi
  trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT
}

write_claim() {
  local tmp
  local tty_value
  tmp="$(mktemp "$CLAIMS_DIR/$QUEST_ID.tmp.XXXXXX")"
  tty_value="$(tty 2>/dev/null || true)"
  if [ -z "$tty_value" ] || [ "$tty_value" = "not a tty" ]; then
    tty_value="not-a-tty"
  fi

  {
    printf 'quest_id=%s\n' "$QUEST_ID"
    printf 'created_at=%s\n' "$(iso_now)"
    printf 'created_epoch=%s\n' "$(now_epoch)"
    printf 'pid=%s\n' "$$"
    printf 'ppid=%s\n' "$PPID"
    printf 'tty=%s\n' "$tty_value"
    printf 'cwd=%s\n' "$PWD"
    printf 'host=%s\n' "$(hostname)"
    printf 'user=%s\n' "${USER:-unknown}"
  } >"$tmp"
  mv "$tmp" "$CLAIM_FILE"
}

check_existing_claim() {
  if [ ! -f "$CLAIM_FILE" ]; then
    return 0
  fi

  local created pid age
  created="$(read_claim_field created_epoch "$CLAIM_FILE")"
  pid="$(read_claim_field pid "$CLAIM_FILE")"
  if [ -z "$created" ]; then
    created=0
  fi
  age="$(claim_age "$created")"

  if [ "${AEQI_CLAIM_FORCE:-0}" = "1" ]; then
    echo "[pre-dispatch] overwriting existing claim because AEQI_CLAIM_FORCE=1"
    return 0
  fi

  if [ "$age" -lt "$CLAIM_TTL_SECS" ]; then
    echo "[pre-dispatch] BLOCKED: active claim exists for $QUEST_ID" >&2
    sed 's/^/  /' "$CLAIM_FILE" >&2
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "  owner_pid_alive=true" >&2
    else
      echo "  owner_pid_alive=false" >&2
    fi
    echo "  age_secs=$age ttl_secs=$CLAIM_TTL_SECS" >&2
    echo "[pre-dispatch] release with --release, or set AEQI_CLAIM_FORCE=1 after manual review" >&2
    exit 4
  fi

  echo "[pre-dispatch] replacing stale claim for $QUEST_ID (age ${age}s >= ${CLAIM_TTL_SECS}s)"
}

repo_exists() {
  [ -d "$1/.git" ] || [ -f "$1/.git" ]
}

section() {
  printf '\n== %s ==\n' "$1"
}

print_worktrees() {
  local repos=(
    "$ROOT/aeqi"
    "$ROOT/aeqi-platform"
    "$ROOT/aeqi-landing"
    "$ROOT/aeqi-docs"
  )

  section "worktrees"
  for repo in "${repos[@]}"; do
    repo_exists "$repo" || continue
    git -C "$repo" worktree list
  done | sort -u

  section "worktree branch deltas"
  while IFS= read -r wt; do
    [ -n "$wt" ] || continue
    printf '\n-- %s --\n' "$wt"
    git -C "$wt" status --short --branch || true
    if git -C "$wt" rev-parse --verify origin/main >/dev/null 2>&1; then
      git -C "$wt" log --oneline --decorate --max-count=5 origin/main..HEAD || true
    else
      git -C "$wt" log --oneline --decorate --max-count=3 || true
    fi
  done < <(
    for repo in "${repos[@]}"; do
      repo_exists "$repo" || continue
      git -C "$repo" worktree list --porcelain | awk '/^worktree / {print $2}'
    done | sort -u
  )
}

print_processes() {
  section "parallel agent processes"
  ps -eo pid=,args= | awk '
    /(^|[ /])(claude|codex)( |$)/ || /@openai\/codex/ { print }
  ' || true
}

print_claims() {
  section "claim files"
  if compgen -G "$CLAIMS_DIR/*.claim" >/dev/null; then
    for claim in "$CLAIMS_DIR"/*.claim; do
      printf '\n-- %s --\n' "$claim"
      sed 's/^/  /' "$claim"
    done
  else
    echo "No claim files in $CLAIMS_DIR."
  fi
}

print_idea_search() {
  section "ideas.search"
  local helper="$HOME/.aeqi/bin/aeqi-mcp-http"
  if [ ! -x "$helper" ]; then
    echo "SKIP — $helper not executable."
    return 0
  fi

  "$helper" ideas "{\"action\":\"search\",\"query\":\"$QUEST_ID active worktree claim collision coordination\",\"limit\":5}" || \
    echo "WARN — ideas.search failed; continue only if local worktree/process checks are clear."
}

if [ "$ACTION" = "release" ]; then
  acquire_lock
  release_claim
  exit 0
fi

acquire_lock
check_existing_claim
write_claim
echo "[pre-dispatch] claimed $QUEST_ID at $CLAIM_FILE"

print_worktrees
print_processes
print_claims
print_idea_search

cat <<EOF

[pre-dispatch] Decision rule:
  - If this output shows another worktree or claim for $QUEST_ID, stop and coordinate.
  - If only unrelated work appears, continue in your quest worktree and keep the claim until close.
  - Release explicitly with: scripts/aeqi-pre-dispatch.sh --release $QUEST_ID
EOF
