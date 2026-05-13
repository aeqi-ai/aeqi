// Real-user web vitals reporter.
//
// LCP — Largest Contentful Paint. Time until the biggest visible element
//       renders. Google target: <2.5s.
// INP — Interaction to Next Paint. Time from a click/tap until the next
//       frame. Google target: <200ms.
// CLS — Cumulative Layout Shift. Sum of every unexpected element move.
//       Google target: <0.1.
//
// Console-only today. A prior version posted to `/api/telemetry/web-vitals`
// but that platform endpoint was never stubbed, so every metric tick logged
// a 401 to the browser console — noise, no telemetry. Restored to a quiet
// console reporter until the platform side ships a real (auth-optional) sink.
//
// To bring back beacon reporting:
//   1. Land `POST /api/telemetry/web-vitals` on aeqi-platform as an
//      unauthenticated 204-returning handler that ingests the JSON body.
//   2. Restore the navigator.sendBeacon path here, gated on
//      `if (!import.meta.env.DEV)`.

import { onCLS, onINP, onLCP, type Metric } from "web-vitals";

export function startWebVitalsReporting(): void {
  if (typeof window === "undefined") return;
  const handler = (metric: Metric) => {
    // Tag every emit so DevTools filter `[web-vitals]` shows the full
    // session-local timeline regardless of dev vs prod.
    console.log(`[web-vitals] ${metric.name}=${metric.value.toFixed(2)} (${metric.rating})`);
  };
  onLCP(handler);
  onINP(handler);
  onCLS(handler);
}
