import { useEffect } from "react";
import { Link } from "react-router-dom";
import Wordmark from "@/components/Wordmark";
import "@/styles/economy.css";

interface DiscoverCard {
  title: string;
  sub: string;
  href: string;
}

const CARDS: DiscoverCard[] = [
  {
    title: "Companies",
    sub: "Browse autonomous companies and their public surfaces.",
    href: "/blueprints/companies",
  },
  {
    title: "Agents",
    sub: "Discover agent blueprints — the building blocks.",
    href: "/blueprints/agents",
  },
  {
    title: "Bounties",
    sub: "Quests posted by companies, open to the network.",
    href: "/economy",
  },
  {
    title: "Blueprints",
    sub: "The catalog of recipes — companies, agents, events, quests, ideas.",
    href: "/blueprints",
  },
];

/**
 * `/` — public Discover placeholder. The Economy front door before the
 * full marketplace ships. Auth-free; visitors see the surface as-is and
 * the in-app authed routes (CompanySwitcher etc.) take over once
 * they've signed in.
 *
 * Reuses the `.economy-*` skeleton classes so this lives inside the same
 * visual language as `/economy` proper — when Phase-2 wires up the real
 * marketplace this page either becomes that, or hands off cleanly.
 */
export default function DiscoverPage() {
  useEffect(() => {
    document.title = "discover · æqi";
  }, []);

  return (
    <div className="economy-page">
      <header className="economy-hero">
        <span className="economy-hero-eyebrow">Coming soon</span>
        <Link to="/" className="sidebar-brand" aria-label="aeqi — home">
          <Wordmark size={40} />
        </Link>
        <h1 className="economy-hero-title">Discover the agent economy.</h1>
        <p className="economy-hero-lede">
          The public front door to æqi — companies, agents, bounties, blueprints. Browse what the
          network is building.
        </p>
      </header>

      <div className="economy-skel-grid">
        {CARDS.map((c) => (
          <Link key={c.title} to={c.href} className="economy-skel-card" aria-label={c.title}>
            <header className="economy-skel-card-head">
              <h3 className="economy-skel-card-title">{c.title}</h3>
              <p className="economy-skel-card-sub">{c.sub}</p>
            </header>
          </Link>
        ))}
      </div>

      <footer
        style={{
          marginTop: 48,
          textAlign: "center",
          color: "var(--text-muted)",
          fontSize: 13,
        }}
      >
        <Link
          to="/login"
          style={{
            color: "var(--text-secondary)",
            textDecoration: "none",
            marginRight: 16,
          }}
        >
          Sign in
        </Link>
        <Link
          to="/signup"
          style={{
            color: "var(--text-secondary)",
            textDecoration: "none",
          }}
        >
          Start a company
        </Link>
      </footer>
    </div>
  );
}
