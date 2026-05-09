import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { Spinner } from "@/components/ui";
import { EmptyState } from "@/components/ui/EmptyState";
import "@/styles/economy.css";

/**
 * `/economy` — public discovery surface for every Company that has
 * flipped `public = true` on its placement. Each card surfaces what's
 * actually on-chain today: a registered TRUST address on Solana, the
 * Company's display name, and (when set) a tagline. Click-through
 * lands on `/trust/<addr>`, the public profile.
 *
 * What's intentionally absent: treasury balances, token mint info,
 * liquidity-pool / funding-round status. The Solana on-chain modules
 * backing those (aeqi_treasury, UniFutures, DEX adapter) are not
 * deployed yet — surfacing fabricated values would lie. When the
 * indexer surfaces them, extend the row.
 */
type EconomyEntity = {
  entity_id: string;
  agent_id: string | null;
  display_name: string;
  tagline: string | null;
  trust_address: string | null;
  created_at: string;
};

const SOLANA_EXPLORER = "https://explorer.solana.com/address";

function shortAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}

function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  const day = 86400_000;
  if (diff < day) return "today";
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  if (diff < 30 * day) return `${Math.floor(diff / (7 * day))}w ago`;
  if (diff < 365 * day) return `${Math.floor(diff / (30 * day))}mo ago`;
  return `${Math.floor(diff / (365 * day))}y ago`;
}

export default function EconomyPage() {
  const navigate = useNavigate();
  const [entities, setEntities] = useState<EconomyEntity[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "economy · aeqi";
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .listEconomy()
      .then((resp) => {
        if (cancelled) return;
        setEntities(resp.entities ?? []);
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = e instanceof ApiError ? e.message : (e as Error).message;
        setLoadError(msg || "Could not reach the economy.");
        setEntities([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = entities === null;
  const total = entities?.length ?? 0;

  return (
    <div className="economy-page">
      <header className="economy-hero">
        <h1 className="economy-hero-title">economy.</h1>
        <p className="economy-hero-lede">
          Every Company with a registered TRUST on Solana. Click through to a public profile, or
          start your own.
        </p>
        <p className="economy-hero-meta">
          {loading
            ? "Loading…"
            : total === 0
              ? "No public companies yet."
              : total === 1
                ? "1 public company"
                : `${total} public companies`}
        </p>
      </header>

      {loading && (
        <div className="economy-status">
          <Spinner size="sm" /> Loading economy…
        </div>
      )}

      {!loading && total === 0 && (
        <EmptyState
          title="The economy is empty for now."
          description={
            loadError ??
            "Companies appear here once their TRUST is registered on Solana and they flip the placement to public. Start your own to be the first."
          }
        />
      )}

      {!loading && total > 0 && (
        <ul className="economy-grid">
          {entities!.map((e) => {
            const trust = e.trust_address;
            const href = trust ? `/trust/${trust}` : `/c/${e.entity_id}`;
            return (
              <li key={e.entity_id}>
                <article
                  className="economy-card"
                  role="link"
                  tabIndex={0}
                  onClick={() => navigate(href)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      navigate(href);
                    }
                  }}
                >
                  <header className="economy-card-head">
                    <h2 className="economy-card-title">{e.display_name || "Untitled"}</h2>
                    {e.tagline && <p className="economy-card-tagline">{e.tagline}</p>}
                  </header>
                  <footer className="economy-card-foot">
                    {trust ? (
                      <a
                        className="economy-card-trust"
                        href={`${SOLANA_EXPLORER}/${trust}`}
                        target="_blank"
                        rel="noreferrer"
                        title={trust}
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        <span className="economy-card-trust-label">TRUST</span>
                        <span className="economy-card-trust-addr">{shortAddress(trust)}</span>
                      </a>
                    ) : (
                      <span className="economy-card-trust economy-card-trust--pending">
                        <span className="economy-card-trust-label">TRUST</span>
                        <span className="economy-card-trust-addr">pending</span>
                      </span>
                    )}
                    <span className="economy-card-since">{formatRelative(e.created_at)}</span>
                  </footer>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
