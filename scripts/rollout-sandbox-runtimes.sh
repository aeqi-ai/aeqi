#!/usr/bin/env bash
# Roll all sandbox runtimes to the currently staged platform runtime binary.
#
# Runtime-impacting deploys copy target/release/aeqi into
# /home/claudedev/aeqi-platform/runtime/bin/aeqi, then restart the platform.
# Sandboxes are transient systemd units, so a unit-list restart only updates
# sandboxes that still exist in systemd. The platform admin API reads
# runtime_placements and respawns missing sandboxes from source-of-truth state.

set -euo pipefail

PLATFORM_URL="${AEQI_PLATFORM_URL:-http://127.0.0.1:8443}"
TIMEOUT_SECS="${AEQI_SANDBOX_ROLLOUT_TIMEOUT_SECS:-60}"

if [ -z "${AEQI_ADMIN_KEY:-}" ]; then
    if [ -f /etc/aeqi/secrets.env ]; then
        if [ -r /etc/aeqi/secrets.env ]; then
            # shellcheck disable=SC1091
            set -a
            source /etc/aeqi/secrets.env
            set +a
            AEQI_ADMIN_KEY="${AEQI_WEB_SECRET:-}"
        elif command -v sudo >/dev/null 2>&1; then
            AEQI_ADMIN_KEY="$(
                sudo bash -lc 'set -a; source /etc/aeqi/secrets.env; printf %s "${AEQI_WEB_SECRET:-}"'
            )"
        fi
    fi
fi

if [ -z "${AEQI_ADMIN_KEY:-}" ]; then
    echo "sandbox rollout skipped: AEQI_ADMIN_KEY/AEQI_WEB_SECRET unavailable" >&2
    exit 1
fi

deadline=$((SECONDS + TIMEOUT_SECS))
until curl -fsS "$PLATFORM_URL/api/health" >/dev/null 2>&1; do
    if [ "$SECONDS" -ge "$deadline" ]; then
        echo "sandbox rollout failed: platform health timed out at $PLATFORM_URL" >&2
        exit 1
    fi
    sleep 1
done

response_file=$(mktemp)
status=$(
    curl -sS -o "$response_file" -w "%{http_code}" \
        -X POST \
        -H "x-admin-key: $AEQI_ADMIN_KEY" \
        "$PLATFORM_URL/api/admin/update"
)

if [ "$status" != "200" ]; then
    echo "sandbox rollout failed: /api/admin/update returned $status" >&2
    cat "$response_file" >&2
    rm -f "$response_file"
    exit 1
fi

if command -v jq >/dev/null 2>&1; then
    ok=$(jq -r '.ok // false' "$response_file")
    succeeded=$(jq -r '.succeeded // 0' "$response_file")
    total=$(jq -r '.total // 0' "$response_file")
    failed=$(jq -r '.failed // 0' "$response_file")
else
    ok=true
    succeeded=unknown
    total=unknown
    failed=unknown
fi

cat "$response_file"
echo
rm -f "$response_file"

if [ "$ok" != "true" ] || [ "$failed" != "0" ]; then
    echo "sandbox rollout incomplete: succeeded=$succeeded total=$total failed=$failed" >&2
    exit 1
fi

echo "sandbox rollout complete: succeeded=$succeeded total=$total"
