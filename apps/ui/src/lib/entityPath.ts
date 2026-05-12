import type { Entity } from "@/lib/types";

/**
 * Canonical URL base for an entity.
 *
 * Trust-backed entities use the trust route. Anything without a trust
 * address should not be treated as a live organization surface.
 */
export function entityBasePath(entity: Pick<Entity, "id" | "trust_address">): string {
  if (entity.trust_address) {
    return `/trust/${entity.trust_address}`;
  }
  return "/launch";
}

/**
 * Full path for an entity + optional sub-path.
 * e.g. entityPath(entity, "roles") → trust route + "/roles".
 * `entityPath(entity)` (no segments) → bare base; the bare URL IS the
 * organization cockpit, so don't pass an "overview" segment — that
 * route redirects back to the bare URL via AppLayout.
 */
export function entityPath(
  entity: Pick<Entity, "id" | "trust_address">,
  ...segments: string[]
): string {
  const base = entityBasePath(entity);
  if (segments.length === 0) return base;
  return `${base}/${segments.join("/")}`;
}

/**
 * Build a canonical path when the call site only has the entity id (not
 * the full Entity object). Resolves to the trust route when the entities
 * lookup hits a row with `trust_address`; otherwise returns the launch
 * surface rather than inventing a legacy route.
 *
 * Use this in components that hold `entityId: string` and have access to
 * the daemon store's `entities` array. Prefer `entityPath(entity, ...)`
 * when an Entity object is in scope — this helper is the id-keyed
 * alternative.
 */
export function entityPathFromId(
  entities: ReadonlyArray<Pick<Entity, "id" | "trust_address">>,
  id: string,
  ...segments: string[]
): string {
  const entity = entities.find((e) => e.id === id);
  if (entity) return entityPath(entity, ...segments);
  return "/launch";
}

/** Same as `entityBasePath` but keyed by id with an entities-array lookup. */
export function entityBasePathFromId(
  entities: ReadonlyArray<Pick<Entity, "id" | "trust_address">>,
  id: string,
): string {
  return entityPathFromId(entities, id);
}
