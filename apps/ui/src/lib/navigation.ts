/**
 * External navigation primitive.
 *
 * CLAUDE.md anti-pattern #4 forbids `window.location.assign` /
 * `window.location.href = …` in component code. The rule exists because
 * SPA-internal navigation that uses raw window.location bypasses React
 * Router, breaks the back button, and (worst case) gets copy-pasted
 * from an external redirect into an internal-navigation context that
 * then full-reloads the app.
 *
 * BUT some redirects are legitimately *external* — they cross the
 * SPA → server boundary (OAuth start endpoints, Stripe Checkout, the
 * auth bounce-out to /login that must clear React state). For those,
 * we need a documented, named primitive instead of a bare
 * `window.location.href` that re-creates the anti-pattern surface.
 *
 * Use `goExternal(url)` for:
 *   - OAuth provider start URLs (`/api/auth/welcome/<provider>/start`)
 *   - Stripe Checkout session URLs returned by the platform
 *   - Full re-mount of /login after sign-out or session expiry
 *
 * Do NOT use for in-app routes — use `navigate(path)` from
 * `useNavigate()` (or `onNavigate` props on reusable section
 * components) instead.
 *
 * The plain-function form is intentional: a hook would require React
 * context, which means `src/api/client.ts` (non-React) couldn't call
 * it. Keeping this as a plain function lets every legitimate caller
 * use the same primitive.
 */
export function goExternal(url: string): void {
  // No analytics hook yet — wire one in here when the platform adds a
  // `external_redirect_started` event. Keeping the surface small for
  // now so the call sites stay trivial to migrate.
  window.location.href = url;
}
