import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { useDaemonStore } from "@/store/daemon";
import type { Entity } from "@/lib/types";

/**
 * Resolves the active company entity from the current route.
 *
 * The canonical route shape is `/trust/:trustAddress/...`.
 * Returns null when neither param is present (e.g. non-company routes)
 * or when the entity cannot be found in the local store.
 */
export function useCurrentCompany(): {
  entity: Entity | null;
  /** The entity id, regardless of which route shape matched. */
  entityId: string;
} {
  const { trustAddress, entityId: routeEntityId } = useParams<{
    trustAddress?: string;
    entityId?: string;
  }>();
  const entities = useDaemonStore((s) => s.entities);

  const entity = useMemo<Entity | null>(() => {
    if (trustAddress) {
      return entities.find((e) => e.trust_address === trustAddress) ?? null;
    }
    if (routeEntityId) {
      return entities.find((e) => e.id === routeEntityId) ?? null;
    }
    return null;
  }, [trustAddress, routeEntityId, entities]);

  return {
    entity,
    entityId: entity?.id ?? routeEntityId ?? "",
  };
}
