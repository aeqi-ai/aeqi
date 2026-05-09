# Inbox streaming — design brief (deferred ship)

Founder report 2026-05-09: when answering a session from `/trust/<addr>/inbox`,
no thinking panel / streaming UI renders — same session viewed via
`/trust/<addr>/agents/<aid>/inbox/<sid>` streams correctly.

## Why it diverges today

Both routes mount `<SessionDetail>`. They feed it different transports:

| Surface | Send path | Render path |
|---|---|---|
| Inbox | `POST /api/inbox/<sid>/answer` (inbox store) | Polling `/api/inbox` snapshot |
| Drilled agent | `useWebSocketChat` + IPC `message_to` | WS `ChatStreamEvent` stream |

The inbox flow inserts a `pending_message` row, claim loop spawns the agent,
the agent's response writes to `session_messages` — but the inbox surface
never subscribes to the WS stream for that session, so `TextDelta` /
`ToolStart` / `StepStart` events never reach the UI. The user sees nothing
until the next inbox poll (and even then, no thinking panel).

## Decision (owner-mode)

Inbox `<SessionDetail>` mounts the same WS streaming subscription the agent
surface uses, scoped to the active session. The POST stays as the trigger
(it carries the `awaiting_at` clear semantics); the response renders over WS.

## Workstream

**WS-1: Lift WS subscription out of `AgentSessionView` into a hook.**
Today `useWebSocketChat` is wired specifically for the agent surface
(per-agent thread state, type-anywhere event bridge, AppLayout composer
mount). Extract a `useSessionStream(sessionId)` that owns just the WS
lifecycle + segment reducer for a single session, no agent-shell
assumptions. Surface the same `liveSegments` / `thinkingStart` /
`streaming` shape `<StreamingMessage>` already consumes.

**WS-2: MeInboxPage feeds `useSessionStream(selectedRow.id)` to SessionDetail.**
SessionDetail accepts the streaming state via the existing `threadTrailingSlot`
contract (per CLAUDE.md "Per-message handlers extend the same way" rule).
Inbox passes a slot that renders `<StreamingMessage>` when streaming; agent
surface keeps its current wiring. Both surfaces converge on the same visual.

**WS-3: Send path stays POST.** `answerInbox` POST keeps clearing
`awaiting_at` atomically; the WS subscription picks up the agent's response
as it streams. No change to `message_to` semantics for the agent surface.

## Why this shape

Per CLAUDE.md "Unify these surfaces — opt-out prop, not divergent render
path": the canonical state is "primitive owns the full chrome." The fix
extracts the streaming primitive (`useSessionStream`), each surface adapts
its data layer to feed it. Same pattern as the SessionDetail extract — the
seam is data-shaped (hook + slot), not behaviour-shaped.

## Estimate

~1 day. The WS infrastructure exists; the lift is hook-extraction +
slot-wiring + parity check across both surfaces (probe scripts per CLAUDE.md
"Probe scripts on inbox surfaces").

## Out of scope (this brief)

- Multi-participant streaming (channels surface) — separate Wave 5 ship.
- Inbox-row-level live thinking indicator (a green dot on the rail row
  while the agent is mid-response). Nice-to-have; queue after WS-2 lands.
