import { useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Inbox as InboxIcon, Store, ArrowUpRight } from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { useEntities } from "@/queries/entities";
import { useInboxStore } from "@/store/inbox";
import { entityPath } from "@/lib/entityPath";
import { sessionDeepUrlFromId } from "@/lib/sessionUrl";
import BlockAvatar from "@/components/BlockAvatar";

/**
 * Start — the home dashboard at `/`. Reframed 2026-05-19 from a 4-card
 * nav hub into a working home:
 *   1. Slim greeting header + account-settings affordance (top-right avatar).
 *   2. Trust quick-select row: avatar chips for each trust the operator
 *      acts in, with [+ New trust] and [Browse blueprints] alongside.
 *   3. Two-column preview row: live inbox (top items) | economy teaser.
 *   4. Thesis snippet linking to the canonical post.
 *
 * The page treats the operator as a real user with work to do — every
 * block is either functional or canonical brand context, never decorative.
 */

const TRUST_CHIP_LIMIT = 6;
const INBOX_PREVIEW_LIMIT = 4;

export default function StartPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const entities = useEntities();
  const inboxItems = useInboxStore((s) => s.items);
  const fetchInbox = useInboxStore((s) => s.fetchInbox);

  const actorName = useMemo(
    () => user?.name?.trim() || user?.email?.split("@")[0] || "friend",
    [user],
  );

  useEffect(() => {
    fetchInbox().catch(() => {
      // inbox store handles its own error state — page renders the
      // empty-preview affordance either way.
    });
  }, [fetchInbox]);

  const trustChips = entities.slice(0, TRUST_CHIP_LIMIT);
  const trustOverflow = Math.max(0, entities.length - TRUST_CHIP_LIMIT);
  const inboxPreview = inboxItems.slice(0, INBOX_PREVIEW_LIMIT);
  const inboxCount = inboxItems.length;

  return (
    <div className="home-page">
      <header className="home-header">
        <div className="home-header-greeting">
          <h1 className="home-header-title">Welcome, {actorName}.</h1>
          <p className="home-header-subtitle">
            Launch a trust, review what needs approval, or step into the economy already forming
            around you.
          </p>
        </div>
        <Link
          to="/account"
          className="home-header-account"
          aria-label="Account settings"
          title="Account settings"
        >
          <BlockAvatar name={actorName} size={36} />
        </Link>
      </header>

      <section className="home-trusts" aria-label="Your trusts">
        <div className="home-section-head">
          <h2 className="home-section-title">Step into a trust</h2>
          <span className="home-section-count">
            {entities.length === 0
              ? "Nothing yet"
              : `${entities.length} trust${entities.length === 1 ? "" : "s"}`}
          </span>
        </div>
        <div className="home-trusts-row">
          {trustChips.map((entity) => (
            <button
              key={entity.id}
              type="button"
              className="home-trust-chip"
              onClick={() => navigate(entityPath(entity))}
              aria-label={`Open ${entity.name}`}
            >
              <span className="home-trust-chip-avatar" aria-hidden="true">
                <BlockAvatar name={entity.name} size={22} />
              </span>
              <span className="home-trust-chip-name">{entity.name}</span>
            </button>
          ))}
          {trustOverflow > 0 && (
            <button
              type="button"
              className="home-trust-chip home-trust-chip--overflow"
              onClick={() => navigate("/trust")}
            >
              +{trustOverflow} more
            </button>
          )}
          <button
            type="button"
            className="home-trust-action home-trust-action--primary"
            onClick={() => navigate("/launch")}
          >
            <Plus size={14} strokeWidth={1.8} />
            <span>New trust</span>
          </button>
          <button
            type="button"
            className="home-trust-action"
            onClick={() => navigate("/blueprints")}
          >
            Browse blueprints
          </button>
        </div>
      </section>

      <section className="home-previews" aria-label="Inbox and economy previews">
        <button
          type="button"
          className="home-preview home-preview--inbox"
          onClick={() => navigate("/inbox")}
        >
          <div className="home-preview-head">
            <span className="home-preview-icon">
              <InboxIcon size={16} strokeWidth={1.5} />
            </span>
            <span className="home-preview-title">Inbox</span>
            <span className="home-preview-meta">
              {inboxCount === 0 ? "All clear" : `${inboxCount} waiting`}
            </span>
          </div>
          {inboxPreview.length > 0 ? (
            <ul className="home-preview-list">
              {inboxPreview.map((item) => (
                <li key={item.session_id} className="home-preview-item">
                  <Link
                    className="home-preview-item-link"
                    to={sessionDeepUrlFromId(
                      entities,
                      item.trust_id,
                      item.agent_id,
                      item.session_id,
                    )}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="home-preview-item-subject">
                      {item.awaiting_subject ||
                        item.session_name ||
                        item.last_agent_message?.slice(0, 80) ||
                        "Untitled session"}
                    </span>
                    <span className="home-preview-item-from">{item.agent_name || "—"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="home-preview-empty">Nothing waiting on you right now.</p>
          )}
          <span className="home-preview-cta">Open inbox →</span>
        </button>

        <button
          type="button"
          className="home-preview home-preview--economy"
          onClick={() => navigate("/economy")}
        >
          <div className="home-preview-head">
            <span className="home-preview-icon">
              <Store size={16} strokeWidth={1.5} />
            </span>
            <span className="home-preview-title">The economy</span>
            <span className="home-preview-meta">Taking shape</span>
          </div>
          <p className="home-preview-lede">
            Marketplace, inference, and billing — the global economy aeqi is building, one rail at a
            time.
          </p>
          <ul className="home-preview-tags">
            <li>Marketplace</li>
            <li>Inference</li>
            <li>Billing</li>
          </ul>
          <span className="home-preview-cta">Browse →</span>
        </button>
      </section>

      <section className="home-thesis" aria-label="Thesis">
        <a
          className="home-thesis-card"
          href="https://aeqi.ai/blog/the-uncompiled-institution"
          target="_blank"
          rel="noreferrer"
        >
          <span className="home-thesis-eyebrow">Thesis</span>
          <h2 className="home-thesis-title">The uncompiled institution</h2>
          <p className="home-thesis-quote">
            Institutions are software that has not been compiled yet.
          </p>
          <div className="home-thesis-meta">
            <span>May 2, 2026 · Luca Eichs</span>
            <span className="home-thesis-read">
              Read on aeqi.ai
              <ArrowUpRight size={14} strokeWidth={1.8} />
            </span>
          </div>
        </a>
      </section>
    </div>
  );
}
