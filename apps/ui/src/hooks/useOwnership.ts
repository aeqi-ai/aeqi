import { useEffect, useState } from "react";

import {
  fetchRolesForTrust,
  fetchRoleRequestsForTrust,
  indexerEnabled,
  type TrustRole,
  type TrustRoleRequest,
} from "@/lib/indexer";

export interface OwnershipState {
  roles: TrustRole[];
  pending: TrustRoleRequest[];
  loading: boolean;
  error: string | null;
}

/**
 * Fetches on-chain role assignments for a TRUST from the indexer.
 *
 * Queries `rolesForTrust(trustId)` and `roleRequestsForTrust(trustId)`.
 * Both queries degrade gracefully to `[]` when the indexer field is not yet
 * shipped — the hook never throws on missing schema fields.
 *
 * Returns empty state when:
 * - `trustId` is falsy (entity has no on-chain TRUST yet).
 * - The indexer is not configured (`VITE_INDEXER_URL` unset / empty).
 */
export function useOwnership(trustId: string | undefined | null): OwnershipState {
  const [roles, setRoles] = useState<TrustRole[]>([]);
  const [pending, setPending] = useState<TrustRoleRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!trustId || !indexerEnabled()) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const [r, req] = await Promise.all([
          fetchRolesForTrust(trustId),
          fetchRoleRequestsForTrust(trustId),
        ]);
        if (!cancelled) {
          setRoles(r);
          setPending(req.filter((rr) => !rr.accepted));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [trustId]);

  return { roles, pending, loading, error };
}
