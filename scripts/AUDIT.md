# Frontend audit — headless-browser recipe

The aeqi UI runs against a live runtime (Rust + WebSockets + JWT-gated
proxy). Type-checking and unit tests can pass while the deployed app is
broken — a `?root=` vs `?entity_id=` typo on a WebSocket query, a
fetch-ordering bug that fires X-Entity-required calls before the entity
is known, a wagmi config that crashes RainbowKit at module init. None
of these surface in `npm run verify`. They only surface when you boot
the app in a real browser, authed as a real user, and watch the
network/console/ws traffic.

This recipe gives that view in one shot.

## Metaprompt — when to run it

Run the audit:

- After any change that touches `apps/ui/src/api/`, `apps/ui/src/hooks/`,
  `apps/ui/src/store/`, the proxy routes (`aeqi-platform/src/routes/`),
  or the `useDaemonSocket` / `useWebSocketChat` hooks. These are the
  layers where a contract change can leave the deployed app silently
  broken — TypeScript types are not load-bearing across the WebSocket
  query string or the X-Entity header.
- After any deploy that crosses the daemon-socket / chat-socket / proxy
  boundary. The `/ship` pipeline doesn't run a browser smoke; the audit
  is the smoke.
- Whenever the user reports "something feels off" without a specific
  error. The audit collapses the search space — top failed endpoints
  and top console errors come out aggregated.

If only `apps/ui/src/components/ui/*` changed (pure UI), skip — the
audit's network-and-console focus won't catch a CSS regression.

## Run

Two pre-reqs: a JWT (the auditor authenticates as a real user) and a
running production server.

### 1. Mint a JWT

```bash
# Reads AEQI_WEB_SECRET from /etc/aeqi-platform/aeqi.env, mints a 24h
# JWT for the named user, registers the jti in user_sessions so the
# token survives a re-load. Edit USER_ID to the canonical UUID for the
# user you're auditing as.
USER_ID=bbbd909d-02ab-4ea6-9da2-98d10d4aeba8 \
  node scripts/_mint-jwt.mjs > /tmp/aeqi-token
```

If you don't have `_mint-jwt.mjs`, the equivalent shell incantation:

```bash
SECRET=$(sudo cat /etc/aeqi-platform/aeqi.env | grep AEQI_WEB_SECRET | cut -d= -f2)
JTI=$(uuidgen)
TOKEN=$(node -e "
  const jwt = require('jsonwebtoken');
  const now = Math.floor(Date.now()/1000);
  console.log(jwt.sign(
    { sub: '$USER_ID', user_id: '$USER_ID', jti: '$JTI', iat: now, exp: now + 86400 },
    '$SECRET',
    { algorithm: 'HS256' }
  ));
")
sudo sqlite3 /var/lib/aeqi-platform/platform.db \
  "INSERT INTO user_sessions (jti, user_id, expires_at, created_at) VALUES ('$JTI', '$USER_ID', strftime('%s', 'now') + 86400, strftime('%s', 'now'));"
echo "$TOKEN"
```

### 2. Run the audit

```bash
AEQI_TOKEN=$(cat /tmp/aeqi-token) node scripts/audit-frontend.mjs
```

Default base URL is `https://app.aeqi.ai`. Override with `AEQI_BASE_URL`
if you want to point at a staging host or `http://localhost:5173` for
the dev server.

The audit walks ~13 routes, captures network + console + WS events for
each, then reloads each route once and verifies the daemon socket
reconnects cleanly (this is the "refresh-reconnect" probe — catches
streaming bugs that only manifest after a browser refresh).

### 3. Read the output

Two artifacts land in `.observations/audit-<timestamp>/`:

- `findings.json` — full per-route capture.
- `<label>.png` — a screenshot of each route, useful to scan visually
  for blank pages / error overlays.

The terminal also prints two aggregates:

- **TOP FAILED ENDPOINTS** — by count, with HTTP status and the routes
  that hit them. `[400] ×24 wss://.../api/ws?token=…&root=...` with
  routes `home,me-inbox,me-profile,...` is the diagnostic for a query-
  param mismatch in `useDaemonSocket.ts`.
- **TOP CONSOLE ERRORS** — by exact-text count. `RainbowKit error: No
  projectId found` ×N catches a wallet-config init crash; `Minified
  React error #185` catches an unstable selector returning a fresh
  reference on every render.

## Triage rules

- **`/api/ws` 400 on every authed route** → query param the proxy
  expects is `entity` or `entity_id`, not `root`. Check
  `useDaemonSocket.ts` and `useWebSocketChat.ts` (chat stream is the
  same proxy boundary).
- **`/api/<endpoint>` 400 with body `X-Entity required` only on `/`** →
  daemon `fetchAll` fired before `fetchEntities` populated
  `localStorage.aeqi_entity`. Gate the proxy fetches on
  `getScopedEntity()` returning non-empty.
- **HEAD requests against the host (status `failed`)** → external probe
  (Cloudflare, uptime monitor). Verify by `nslookup` on the requesting
  IP; usually benign.
- **Console error: `Minified React error #185`** → unstable selector
  returning a fresh reference (filter/map inside a Zustand selector).
  Subscribe to raw fields and `useMemo` at the consumer.
- **Reload-reconnect produces 0 ws events** → daemon socket isn't
  reopening on mount. Check `useDaemonSocket`'s effect dep list and
  cleanup.
- **A route's screenshot is blank but no page-error** → wallet config
  init or other module-level crash blanking the React tree before mount.
  Inspect the bundled chunks via `view-source:` on the URL or a
  `page.evaluate(() => document.body.innerHTML)` probe.

## Anti-patterns — don't do these

- Don't run the audit against a stale token. The JWT lives in
  `user_sessions`; if you've deployed since minting it, re-mint —
  systemd restarts can roll the secret if `aeqi.env` changes.
- Don't read `findings.json` line-by-line by hand. The aggregates exist
  for a reason. Drop into the JSON only when one of them flags a
  pattern that needs full request context.
- Don't add the audit's screenshots to the repo. They go in
  `.observations/` which is gitignored.
- Don't conflate the daemon socket (`/api/ws`, always-on,
  per-app-mount) with the chat socket (`/api/chat/stream`, per-message
  or per-attach). They use the same proxy but the lifecycle is
  different — a chat-socket 400 is only visible if a session is
  in-flight or a message has been sent.

## Boundary with `/ship`

The audit is a manual smoke. `/ship` does not run it — it would block
deploys on flaky infra (rate limits, Cloudflare blips). Run the audit
yourself when you've shipped something the audit specifically catches:
contract changes at the network/socket boundary.
