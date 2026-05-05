import { useNavigate, useParams } from "react-router-dom";
import { useCallback, useMemo } from "react";
import { useDaemonStore } from "@/store/daemon";
import { entityBasePath, entityPath as makeEntityPath } from "@/lib/entityPath";

/**
 * Navigate within the current company scope.
 *
 * Supports both `/trust/:trustAddress/...` (on-chain canonical) and
 * `/c/:entityId/...` (pending / legacy) shapes. `go()` / `href()` stay
 * within the current entity's URL scope; `goEntity()` / `entityPath()`
 * target a specific entity by id (resolving to /trust/ when available).
 */
export function useNav() {
  const navigate = useNavigate();
  const { entityId, trustAddress } = useParams<{ entityId?: string; trustAddress?: string }>();
  const entities = useDaemonStore((s) => s.entities);

  // Resolve the base path for the current route's entity. On-chain entities
  // use /trust/<addr>; pending use /c/<id>.
  const base = useMemo(() => {
    if (trustAddress) {
      // Already on a /trust/ route — keep the same prefix.
      return `/trust/${trustAddress}`;
    }
    if (!entityId) return "";
    const entity = entities.find((e) => e.id === entityId);
    return entity ? entityBasePath(entity) : `/c/${encodeURIComponent(entityId)}`;
  }, [trustAddress, entityId, entities]);

  const go = useCallback(
    (path: string, options?: { replace?: boolean }) => {
      const full = path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
      navigate(full, options);
    },
    [navigate, base],
  );

  const href = useCallback(
    (path: string) => {
      return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
    },
    [base],
  );

  /**
   * Absolute path for a company surface. Resolves to /trust/<addr> when
   * the entity has a trust_address, otherwise /c/<id>.
   */
  const entityPath = useCallback(
    (id: string, tab?: string, itemId?: string) => {
      const entity = entities.find((e) => e.id === id);
      const parts = [tab, itemId].filter(Boolean) as string[];
      return entity
        ? makeEntityPath(entity, ...parts)
        : [`/c/${encodeURIComponent(id)}`, ...parts].join("/");
    },
    [entities],
  );

  const goEntity = useCallback(
    (
      id: string,
      tab?: string,
      itemId?: string,
      options?: { replace?: boolean; search?: Record<string, string> },
    ) => {
      let path = entityPath(id, tab, itemId);
      if (options?.search) {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(options.search)) {
          if (v !== undefined && v !== "") params.set(k, v);
        }
        const qs = params.toString();
        if (qs) path += `?${qs}`;
      }
      navigate(path, { replace: options?.replace });
    },
    [navigate, entityPath],
  );

  const resolvedEntityId = entityId || "";

  return { go, href, entityPath, goEntity, entityId: resolvedEntityId, base };
}
