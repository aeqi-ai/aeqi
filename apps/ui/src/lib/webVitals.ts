// Real-user web vitals reporter.
//
// LCP — Largest Contentful Paint. Time until the biggest visible element
//       renders. Google target: <2.5s.
// INP — Interaction to Next Paint. Time from a click/tap until the next
//       frame. Google target: <200ms.
// CLS — Cumulative Layout Shift. Sum of every unexpected element move.
//       Google target: <0.1.
//
// Reports to the console in dev; posts to /api/telemetry/web-vitals in
// prod as a fire-and-forget beacon. Failures (404, 4xx, network) are
// swallowed — telemetry MUST NOT break the UI.

import { onCLS, onINP, onLCP, type Metric } from "web-vitals";

type WebVitalsMetric = Pick<Metric, "name" | "value" | "rating" | "id" | "delta">;

function sendBeacon(metric: WebVitalsMetric): void {
  const body = JSON.stringify({
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    id: metric.id,
    delta: metric.delta,
    url: window.location.pathname,
    ts: Date.now(),
  });
  // navigator.sendBeacon survives page unloads (LCP often fires on
  // visibility hidden) without keeping the response open. Falls back to
  // fetch for browsers without the API.
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/telemetry/web-vitals", body);
      return;
    }
    void fetch("/api/telemetry/web-vitals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      /* telemetry never fails the UI */
    });
  } catch {
    /* same */
  }
}

export function startWebVitalsReporting(): void {
  if (typeof window === "undefined") return;
  const isDev = import.meta.env.DEV;
  const handler = (metric: Metric) => {
    if (isDev) {
      console.log(`[web-vitals] ${metric.name}=${metric.value.toFixed(2)} (${metric.rating})`);
      return;
    }
    sendBeacon(metric);
  };
  onLCP(handler);
  onINP(handler);
  onCLS(handler);
}
