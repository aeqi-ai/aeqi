import type { Entity } from "@/lib/types";

/**
 * Canonical URL base for an entity.
 *
 * - On-chain entities (trust_address set): `/trust/<address>`
 * - Pending / off-chain entities:          `/c/<id>`
 *
 * Use this everywhere a link or navigation targets a company entity so
 * the address is consistently the primary URL once registerTRUST lands.
 */
export function entityBasePath(entity: Pick<Entity, "id" | "trust_address">): string {
  if (entity.trust_address) {
    return `/trust/${entity.trust_address.toLowerCase()}`;
  }
  return `/c/${encodeURIComponent(entity.id)}`;
}

/**
 * Full path for an entity + optional sub-path.
 * e.g. entityPath(entity, "overview") → "/trust/0xabc.../overview"
 */
export function entityPath(
  entity: Pick<Entity, "id" | "trust_address">,
  ...segments: string[]
): string {
  const base = entityBasePath(entity);
  if (segments.length === 0) return base;
  return `${base}/${segments.join("/")}`;
}
