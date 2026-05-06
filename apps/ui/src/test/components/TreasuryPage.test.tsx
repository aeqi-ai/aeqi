import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StrictMode } from "react";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TreasuryPage from "@/pages/TreasuryPage";
import { api } from "@/lib/api";
import { useDaemonStore } from "@/store/daemon";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TRUST_ADDRESS = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

const ENTITY = {
  id: "entity-1",
  name: "Acme Corp",
  type: "company" as const,
  status: "active" as const,
  created_at: "2026-01-01T00:00:00Z",
  trust_address: TRUST_ADDRESS,
};

const BILLING_OVERVIEW = {
  ok: true,
  total_monthly_cents: 1900,
  total_annual_cents: 22800,
  currency: "usd",
  companies: [
    {
      name: "Acme Corp",
      agent_id: "entity-1",
      plan: "company" as const,
      stripe_subscription_id: "sub_123",
      status: "active" as const,
      next_charge_at: "2026-06-01T00:00:00Z",
    },
  ],
  payment_method_last4: "4242",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderPage(entityId = "entity-1") {
  return render(
    <StrictMode>
      <MemoryRouter>
        <TreasuryPage entityId={entityId} />
      </MemoryRouter>
    </StrictMode>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TreasuryPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useDaemonStore.setState({
      entities: [ENTITY],
      agents: [],
      quests: [],
      events: [],
    } as never);
    // Default: billing resolves fine.
    vi.spyOn(api, "getBillingOverview").mockResolvedValue(BILLING_OVERVIEW);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the Treasury heading", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: /treasury/i })).toBeInTheDocument();
  });

  it("shows the contract info row when trust_address is present", async () => {
    renderPage();
    // The contract info row shows a truncated address and a Base Sepolia link.
    await waitFor(() => {
      expect(screen.getByText(/base sepolia/i)).toBeInTheDocument();
    });
    // Truncated: 0xdeadb…beef
    expect(screen.getByText(/0xdead/)).toBeInTheDocument();
  });

  it("shows Holdings and Recent transfers section labels", async () => {
    renderPage();
    // Section labels are uppercase via CSS, but the DOM text is lowercase.
    await waitFor(() => {
      expect(screen.getByText(/holdings/i)).toBeInTheDocument();
      expect(screen.getByText(/recent transfers/i)).toBeInTheDocument();
    });
  });

  it("shows empty-state copy in both sections when indexer returns no data", async () => {
    renderPage();
    // useTreasury will hit the indexer, get field-not-found errors for
    // transfers, and [] from module fetch (no modules seeded). Both sections
    // land on the empty state.
    await waitFor(
      () => {
        // Holdings empty state shows the zero-balance line.
        expect(screen.getByText("0 ETH · 0 USDC")).toBeInTheDocument();
        // Transfers empty state.
        expect(
          screen.getByText(/once your treasury earns or spends, transfers will appear here/i),
        ).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it("shows the billing card after a successful overview fetch", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Company subscription")).toBeInTheDocument();
    });
    expect(screen.getByText(/manage billing/i)).toBeInTheDocument();
  });

  it("shows an EmptyState when the entity has no subscription", async () => {
    vi.spyOn(api, "getBillingOverview").mockResolvedValue({
      ok: true,
      total_monthly_cents: 0,
      total_annual_cents: 0,
      currency: "usd",
      companies: [],
      payment_method_last4: null,
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/no subscription on this company/i)).toBeInTheDocument();
    });
  });

  it("shows the billing error message when the API rejects", async () => {
    vi.spyOn(api, "getBillingOverview").mockRejectedValue(new Error("network timeout"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/couldn't load billing/i)).toBeInTheDocument();
      expect(screen.getByText(/network timeout/i)).toBeInTheDocument();
    });
  });

  it("does not render the contract row when no trust_address is set", async () => {
    useDaemonStore.setState({
      entities: [{ ...ENTITY, trust_address: undefined }],
      agents: [],
      quests: [],
      events: [],
    } as never);

    renderPage();

    await screen.findByRole("heading", { name: /treasury/i });
    expect(screen.queryByText(/base sepolia/i)).not.toBeInTheDocument();
  });

  it("renders the Resource pack section", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/resource pack/i)).toBeInTheDocument();
      expect(screen.getByText(/inference \/ month/i)).toBeInTheDocument();
    });
  });
});
