import styles from "./Banner.module.css";

export type BannerKind = "success" | "error" | "warning" | "info";

export interface BannerProps {
  kind: BannerKind;
  children: React.ReactNode;
  className?: string;
}

/**
 * Inline tinted feedback banner — success/error/warning/info.
 *
 * Shape: tinted background, no border (anti-hairline rule), no icon by
 * default. Used for inline form feedback ("Profile updated", "Invalid
 * code"), API errors at the top of a panel, and any short status
 * message that lives in the page rather than a transient toast.
 *
 * `role` and `aria-live` are co-derived from `kind`: errors/warnings get
 * `role="alert"` + `aria-live="assertive"` so screen readers interrupt;
 * success/info get `role="status"` + `aria-live="polite"`. Both must
 * match — `role="alert"` with `aria-live="polite"` silently downgrades
 * the urgency (the explicit aria-live wins over the role's implicit
 * value), which is why this pair is set together here instead of
 * letting callers override either.
 */
export function Banner({ kind, children, className }: BannerProps) {
  const isUrgent = kind === "error" || kind === "warning";
  const role = isUrgent ? "alert" : "status";
  const liveness = isUrgent ? "assertive" : "polite";
  const cls = [styles.banner, styles[kind], className].filter(Boolean).join(" ");
  return (
    <div className={cls} role={role} aria-live={liveness}>
      {children}
    </div>
  );
}

Banner.displayName = "Banner";
