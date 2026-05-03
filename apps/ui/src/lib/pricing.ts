/** Mirrored from aeqi-landing/src/pricing.ts. Single source of truth for pricing.
 *  Update both files when prices change.
 *
 *  One offer. $19 first month, $49 / month after. Stripe runs this as a single
 *  $49 / mo Product with an auto-applied first-month coupon (-$30, duration:
 *  once). Day-0 charge is $19; every subsequent month is $49. No tier picker,
 *  no trial, no annual. `FOUNDER_FEE` is the effective first-month price.
 */

export const FOUNDER_FEE = 19;
export const COMPANY_MONTHLY = 49;

export const RESOURCE_PACK = {
  tokens: "16M",
  cpu: "4 vCPU",
  ram: "8 GB",
  storage: "80 GB",
} as const;

export interface Feature {
  text: string;
  highlight?: boolean;
  soon?: boolean;
}

export const FEATURES: Feature[] = [
  { text: "Run your own autonomous company" },
  { text: "Unlimited agents" },
  { text: "Managed hosting + custom domain" },
  { text: "Built-in ownership & governance" },
  { text: "On-demand token top-ups" },
  { text: `${RESOURCE_PACK.tokens} tokens / month`, highlight: true },
  {
    text: `${RESOURCE_PACK.cpu} · ${RESOURCE_PACK.ram} RAM · ${RESOURCE_PACK.storage} storage`,
    highlight: true,
  },
  { text: "API + MCP access" },
  { text: "Mobile app", soon: true },
];

/** Single plan identifier used everywhere — DB, Stripe metadata, API. */
export const PLAN_ID = "company" as const;
export type PlanId = typeof PLAN_ID;

/** Format integer cents as a localized currency string. */
export function formatCents(cents: number, currency: string = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
