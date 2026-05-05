import { useEffect, useRef, useState } from "react";

import {
  fetchTokenHolders,
  fetchTrustModules,
  findModuleByType,
  indexerEnabled,
} from "@/lib/indexer";

// ── Shape of a token holding ──────────────────────────────────────────────────

export interface TokenBalance {
  /** ERC-20 symbol inferred from address (indexer v1 returns address only). */
  symbol: string;
  /** Raw balance string from the indexer (no decimals applied — display as-is). */
  amount: string;
  /** Holder address — the TRUST proxy itself or a delegated beneficiary. */
  holderAddress: string;
  /** Last-updated block number. */
  lastUpdatedBlock: number;
}

// ── Shape of a transfer ───────────────────────────────────────────────────────

export type TransferDirection = "in" | "out";

export interface TreasuryTransfer {
  direction: TransferDirection;
  /** Counter-party address (full, truncation is a display concern). */
  counterparty: string;
  /** Human-readable amount string. */
  amount: string;
  /** Block number the transfer was confirmed. */
  block: number;
}

// ── Hook result ───────────────────────────────────────────────────────────────

export interface TreasuryState {
  /** Null = loading; [] = loaded (empty or unavailable). */
  balances: TokenBalance[] | null;
  /** Null = loading; [] = loaded (empty or unavailable). */
  transfers: TreasuryTransfer[] | null;
  /** True only while the initial fetch is in-flight. */
  loading: boolean;
}

// Emitted at most once per mounted hook instance.
const WARN_KEY = "__useTreasury_warned__";

function isFieldNotFoundError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  // GraphQL "field not found" variants from common implementations.
  return /field.*not.*found|unknown field|cannot query field/i.test(msg);
}

/**
 * Fetches on-chain treasury state (token holdings + recent transfers) for an
 * entity's TRUST contract.
 *
 * Graceful-degrade: if the indexer hasn't been extended with
 * `treasuryBalances` / `treasuryTransfers` fields yet, the hook silently
 * returns [] for both and logs a one-time warning. The tab still renders its
 * empty-state UI — no broken surface in prod.
 *
 * Returns `{ balances: null, transfers: null, loading: true }` while
 * fetching; `loading: false` once settled (with [] on error / disabled).
 */
export function useTreasury(trustAddress: string | undefined): TreasuryState {
  const [balances, setBalances] = useState<TokenBalance[] | null>(null);
  const [transfers, setTransfers] = useState<TreasuryTransfer[] | null>(null);
  const warnedRef = useRef(false);

  useEffect(() => {
    // Reset on address change.
    setBalances(null);
    setTransfers(null);

    if (!trustAddress || !indexerEnabled()) {
      setBalances([]);
      setTransfers([]);
      return;
    }

    let cancelled = false;

    const warn = (msg: string) => {
      if (!warnedRef.current && !(globalThis as Record<string, unknown>)[WARN_KEY]) {
        console.warn(`[useTreasury] ${msg}`);
        warnedRef.current = true;
        (globalThis as Record<string, unknown>)[WARN_KEY] = true;
      }
    };

    (async () => {
      try {
        // ── Step 1: resolve modules for this TRUST ────────────────────────
        const modules = await fetchTrustModules(trustAddress);
        if (cancelled) return;

        const tokenModule = findModuleByType(modules, "token");

        // ── Step 2: token holdings ────────────────────────────────────────
        let resolvedBalances: TokenBalance[] = [];
        if (tokenModule) {
          try {
            const raw = await fetchTokenHolders(tokenModule.moduleAddress);
            if (!cancelled) {
              resolvedBalances = raw.map((r) => ({
                // indexer v1 doesn't include symbol; derive a short label from
                // the address until the extension ships.
                symbol: `${r.tokenAddress.slice(2, 6).toUpperCase()}`,
                amount: r.balance,
                holderAddress: r.holderAddress,
                lastUpdatedBlock: r.lastUpdatedBlock,
              }));
            }
          } catch (err) {
            if (isFieldNotFoundError(err)) {
              warn("indexer not extended yet — treasuryBalances field missing");
            }
            // Leave resolvedBalances as [].
          }
        }
        if (!cancelled) setBalances(resolvedBalances);

        // ── Step 3: recent transfers ──────────────────────────────────────
        // The `treasuryTransfers` field is expected as part of the Roles+Treasury
        // indexer extension (separate workstream). Until it lands, we return [].
        let resolvedTransfers: TreasuryTransfer[] = [];
        try {
          // Attempt optimistic query — will throw "field not found" until the
          // extension is deployed.
          const data = await fetchTreasuryTransfers(trustAddress);
          if (!cancelled) resolvedTransfers = data;
        } catch (err) {
          if (isFieldNotFoundError(err)) {
            warn("indexer not extended yet — treasuryTransfers field missing");
          }
          // Leave resolvedTransfers as [].
        }
        if (!cancelled) setTransfers(resolvedTransfers);
      } catch {
        // Module fetch failure — treat whole section as empty.
        if (!cancelled) {
          setBalances([]);
          setTransfers([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [trustAddress]);

  const loading = balances === null || transfers === null;
  return { balances, transfers, loading };
}

// ── Optimistic GraphQL call for transfers (extension not yet deployed) ────────
//
// This will throw with a "field not found" GraphQL error until the indexer
// extension lands. The hook catches that and degrades gracefully.

interface RawTransfer {
  direction: string;
  counterparty: string;
  amount: string;
  block: number;
}

async function fetchTreasuryTransfers(trustAddress: string): Promise<TreasuryTransfer[]> {
  if (!indexerEnabled()) return [];

  // The path must match what aeqi-platform proxies. Override via VITE_INDEXER_URL.
  const INDEXER_URL =
    (import.meta.env.VITE_INDEXER_URL as string | undefined) === undefined
      ? "/indexer/graphql"
      : (import.meta.env.VITE_INDEXER_URL as string) || null;

  if (!INDEXER_URL) return [];
  const resp = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `query($a: String!, $limit: Int!) {
        treasuryTransfers(trustAddress: $a, limit: $limit) {
          direction counterparty amount block
        }
      }`,
      variables: { a: trustAddress.toLowerCase(), limit: 20 },
    }),
  });

  if (!resp.ok) throw new Error(`indexer http ${resp.status}`);

  interface TransferResponse {
    data?: { treasuryTransfers?: RawTransfer[] };
    errors?: { message: string }[];
  }

  const json = (await resp.json()) as TransferResponse;
  if (json.errors && json.errors.length > 0) {
    throw new Error(`indexer graphql: ${json.errors.map((e) => e.message).join("; ")}`);
  }

  return (json.data?.treasuryTransfers ?? []).map((r) => ({
    direction: (r.direction === "out" ? "out" : "in") as TransferDirection,
    counterparty: r.counterparty,
    amount: r.amount,
    block: r.block,
  }));
}
