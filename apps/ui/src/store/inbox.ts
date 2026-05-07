import { create } from "zustand";
import { api, type InboxItem } from "@/lib/api";
import { getScopedEntity } from "@/lib/appMode";

// Optimistic dismissal hides via pendingDismissal instead of mutating
// `items` so an error path can `restoreItem` without re-fetching, and a
// duplicate WS clear for an already-dismissed item is a no-op.
export interface InboxState {
  items: InboxItem[];
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  /** session_ids hidden by an in-flight or just-completed answer. */
  pendingDismissal: Set<string>;

  fetchInbox: () => Promise<void>;
  answerItem: (sessionId: string, answer: string) => Promise<{ ok: boolean; error?: string }>;
  dismissItem: (sessionId: string) => Promise<{ ok: boolean; error?: string }>;
  pushInboxUpdate: (payload: InboxUpdatePayload) => void;
  dismissOptimistically: (sessionId: string) => void;
  restoreItem: (sessionId: string) => void;
  clearInbox: () => void;
}

// Module-level probe: attempt HEAD on the dismiss endpoint once per deploy.
// If it 404s, the endpoint isn't deployed yet — gate the archive button.
//
// Cached in localStorage keyed by deploy hash so:
//  (a) every fresh tab on the same deploy is a cache hit (no probe fire)
//  (b) a new deploy invalidates automatically — cache key changes when the
//      hashed `index-XXXX.js` filename changes
// The bearer token is forwarded so the probe matches the same auth-required
// surface the real dismiss POST hits.
const PROBE_CACHE_KEY_PREFIX = "aeqi_inbox_probe_v2_";

// Derive the current deploy hash from the live `index-<hash>.js` script tag
// vite emits. Falls back to a stable string when the script tag isn't found
// (dev server, SSR, or a future bundler shape) — the probe still runs once
// per cache wipe in that case.
function getDeployHash(): string {
  try {
    const scripts = document.querySelectorAll<HTMLScriptElement>("script[src*=index-]");
    for (const s of Array.from(scripts)) {
      const m = s.src.match(/index-([A-Za-z0-9_-]+)\.js/);
      if (m) return m[1];
    }
  } catch {
    // document unavailable — fall through.
  }
  return "dev";
}

let dismissEndpointAvailable: boolean | null = null;
export async function probeDismissEndpoint(): Promise<boolean> {
  if (dismissEndpointAvailable !== null) return dismissEndpointAvailable;

  const cacheKey = PROBE_CACHE_KEY_PREFIX + getDeployHash();
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached === "1" || cached === "0") {
      dismissEndpointAvailable = cached === "1";
      return dismissEndpointAvailable;
    }
  } catch {
    // localStorage unavailable (private mode, etc.) — fall through to live probe.
  }

  const token = localStorage.getItem("aeqi_token");
  // Skip the probe entirely pre-auth — the route is auth-required and a
  // pre-auth HEAD will 401, which leaks into the console as a network error.
  // The probe will run on the next call after login.
  if (!token) {
    return false;
  }

  // The platform proxy on /api/inbox/* requires an X-Entity header — without
  // it the catch-all extracts a missing entity id and returns 400 (NOT 401),
  // which leaks a console error on every inbox mount. Skip the probe until an
  // entity scope is set; the next inbox mount with a real X-Entity will run
  // the probe cleanly. This mirrors the daemon-store fetchAll ordering rule
  // (entity-scoped fetches gate on getScopedEntity()).
  const entityId = getScopedEntity();
  if (!entityId) {
    return false;
  }

  try {
    // Use a dummy session ID; a 404 from the route itself vs. a 405/200
    // tells us whether the endpoint exists at all. The platform returns 404
    // for unknown session IDs on real endpoints, but returns a generic 404
    // when the route doesn't exist at all — indistinguishable here, so we
    // treat any non-network-error / non-401 as "endpoint deployed" and let
    // the store handle 404 per-call gracefully.
    const resp = await fetch("/api/inbox/__probe__/dismiss", {
      method: "HEAD",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Entity": entityId,
      },
    });
    // 401 = auth failed (transient — don't cache). 400 = entity scope rejected
    // (also transient; the localStorage entity may have been pruned by a sign-out
    // race). Network failures (resp.status === 0) are transient too. 404/405/2xx
    // = route registered → cache the verdict for this deploy.
    if (resp.status === 401 || resp.status === 400 || resp.status === 0) {
      return false;
    }
    dismissEndpointAvailable = true;
    try {
      localStorage.setItem(cacheKey, "1");
    } catch {
      // localStorage write failure — non-fatal, we'll re-probe next mount.
    }
    return true;
  } catch {
    // Network error / fetch threw — don't cache; retry next session.
    return false;
  }
}

// MVP server emits a full snapshot on signature change; v2 may layer
// fine-grained add/clear deltas on top without breaking the snapshot path.
export type InboxUpdatePayload =
  | { count: number; items: InboxItem[] }
  | { kind: "added"; item: InboxItem }
  | { kind: "cleared"; session_id: string };

export const useInboxStore = create<InboxState>((set, get) => ({
  items: [],
  loading: false,
  error: null,
  lastFetchedAt: null,
  pendingDismissal: new Set<string>(),

  fetchInbox: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const resp = await api.getInbox();
      const items = Array.isArray(resp?.items) ? resp.items : [];
      // Drop pendingDismissal entries the server has already cleared;
      // ones still present stay hidden until the WS clears them.
      set((s) => {
        const next = new Set(s.pendingDismissal);
        const present = new Set(items.map((i) => i.session_id));
        for (const id of next) {
          if (!present.has(id)) next.delete(id);
        }
        return {
          items,
          loading: false,
          lastFetchedAt: Date.now(),
          pendingDismissal: next,
        };
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  answerItem: async (sessionId, answer) => {
    // Optimistic dismiss so the row collapses while the POST flies.
    get().dismissOptimistically(sessionId);
    try {
      const resp = await api.answerInbox(sessionId, answer);
      if (!resp.ok) {
        get().restoreItem(sessionId);
        return { ok: false, error: resp.error || "answer failed" };
      }
      return { ok: true };
    } catch (err) {
      get().restoreItem(sessionId);
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  dismissItem: async (sessionId) => {
    get().dismissOptimistically(sessionId);
    try {
      const resp = await api.dismissInbox(sessionId);
      if (!resp.ok) {
        get().restoreItem(sessionId);
        return { ok: false, error: resp.error || "dismiss failed" };
      }
      return { ok: true };
    } catch (err) {
      get().restoreItem(sessionId);
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  pushInboxUpdate: (payload) => {
    if ("kind" in payload) {
      // Forward-compat with v2 fine-grained deltas.
      if (payload.kind === "added") {
        set((s) => {
          if (s.items.some((i) => i.session_id === payload.item.session_id)) {
            return s;
          }
          return { items: [payload.item, ...s.items] };
        });
      } else if (payload.kind === "cleared") {
        set((s) => {
          const next = new Set(s.pendingDismissal);
          next.delete(payload.session_id);
          return {
            items: s.items.filter((i) => i.session_id !== payload.session_id),
            pendingDismissal: next,
          };
        });
      }
      return;
    }
    set((s) => {
      const present = new Set(payload.items.map((i) => i.session_id));
      const next = new Set(s.pendingDismissal);
      for (const id of next) {
        if (!present.has(id)) next.delete(id);
      }
      return { items: payload.items, pendingDismissal: next };
    });
  },

  dismissOptimistically: (sessionId) => {
    set((s) => {
      const next = new Set(s.pendingDismissal);
      next.add(sessionId);
      return { pendingDismissal: next };
    });
  },

  restoreItem: (sessionId) => {
    set((s) => {
      const next = new Set(s.pendingDismissal);
      next.delete(sessionId);
      return { pendingDismissal: next };
    });
  },

  clearInbox: () => {
    set({
      items: [],
      loading: false,
      error: null,
      lastFetchedAt: null,
      pendingDismissal: new Set<string>(),
    });
  },
}));

// Selectors co-located so consumers share one stable reference and don't
// allocate a fresh filter result every render (would re-trigger React).
export const selectVisibleItems = (s: InboxState): InboxItem[] =>
  s.items.filter((i) => !s.pendingDismissal.has(i.session_id));

/**
 * Count of sessions awaiting a human reply — the badge value the rail
 * surfaces to indicate "X things need you." After 2026-05-07 the inbox
 * stream returns every session in scope (history); this selector stays
 * narrow to awaiting items so the badge keeps its prior meaning.
 */
export const selectInboxCount = (s: InboxState): number =>
  s.items.filter((i) => !!i.awaiting_at && !s.pendingDismissal.has(i.session_id)).length;
