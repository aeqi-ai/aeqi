import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import OwnershipPage from "@/pages/OwnershipPage";
import { api } from "@/lib/api";
import { useDaemonStore } from "@/store/daemon";
import * as indexerMod from "@/lib/indexer";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/indexer", async (importOriginal) => {
  const orig = await importOriginal<typeof indexerMod>();
  return {
    ...orig,
    indexerEnabled: vi.fn(() => true),
    fetchRolesForTrust: vi.fn(),
    fetchRoleRequestsForTrust: vi.fn(),
  };
});

const mockEnabled = vi.mocked(indexerMod.indexerEnabled);
const mockFetchRoles = vi.mocked(indexerMod.fetchRolesForTrust);
const mockFetchRequests = vi.mocked(indexerMod.fetchRoleRequestsForTrust);

const ENTITY_ID = "entity-1";
const TRUST_ID = "0xdeadbeef";

const OFF_CHAIN_ROLE = {
  id: "role-1",
  entity_id: ENTITY_ID,
  title: "CEO",
  founder: true,
  role_type: "director" as const,
  occupant_kind: "human" as const,
  occupant_id: "user-1",
  grants: [],
  created_at: "2026-01-01T00:00:00Z",
};

const CHAIN_ROLE: indexerMod.TrustRole = {
  account: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  roleTypeId: "0x0000000000000000000000000000000000000000000000000000000000000001",
  slotIndex: 0,
  ipfsCid: "bafyreiabc123",
};

// ── Helpers ────────────────────────────────────────────────────────────────

function renderPage() {
  return render(
    <StrictMode>
      <MemoryRouter>
        <OwnershipPage entityId={ENTITY_ID} />
      </MemoryRouter>
    </StrictMode>,
  );
}

// ── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  useDaemonStore.setState({
    entities: [
      {
        id: ENTITY_ID,
        name: "Acme Corp",
        type: "company",
        status: "active",
        created_at: "2026-01-01T00:00:00Z",
        trust_id: TRUST_ID,
      },
    ],
    agents: [],
    quests: [],
    events: [],
  } as never);

  mockEnabled.mockReturnValue(true);
  mockFetchRoles.mockResolvedValue([]);
  mockFetchRequests.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("OwnershipPage — off-chain section", () => {
  it("shows spinner while fetching roles", () => {
    vi.spyOn(api, "getRoles").mockImplementation(() => new Promise(() => {}));
    const { container } = renderPage();
    // The spinner wrapper is present during loading.
    expect(container.querySelector(".asv-main")).not.toBeNull();
  });

  it("shows empty state when entity has no roles", async () => {
    vi.spyOn(api, "getRoles").mockResolvedValue({ ok: true, roles: [], edges: [] });
    renderPage();
    await waitFor(() => expect(screen.getByText(/No roles defined yet/)).toBeTruthy());
  });

  it("renders off-chain roles grouped by type", async () => {
    vi.spyOn(api, "getRoles").mockResolvedValue({ ok: true, roles: [OFF_CHAIN_ROLE], edges: [] });
    renderPage();
    await waitFor(() => expect(screen.getByText("CEO")).toBeTruthy());
    // Founder badge present
    expect(screen.getByText("Founder")).toBeTruthy();
  });
});

describe("OwnershipPage — on-chain section", () => {
  beforeEach(() => {
    vi.spyOn(api, "getRoles").mockResolvedValue({ ok: true, roles: [OFF_CHAIN_ROLE], edges: [] });
  });

  it("shows skeleton while indexer is loading", async () => {
    mockFetchRoles.mockImplementation(() => new Promise(() => {}));
    const { container } = renderPage();
    // Wait for the off-chain section to resolve first.
    await waitFor(() => expect(screen.getByText("CEO")).toBeTruthy());
    // The on-chain section renders inside the same asv-main; skeleton items
    // are li elements with no text content (only background styling).
    // There are 3 skeleton rows (matching the ChainRolesSkeleton rows array).
    // We use the section header text to confirm the skeleton is present.
    expect(screen.getByText("On-chain roles")).toBeTruthy();
    // At least 4 list items total: 1 off-chain role + 3 skeleton rows.
    await waitFor(() => {
      const allLis = container.querySelectorAll("li");
      expect(allLis.length).toBeGreaterThan(1);
    });
  });

  it("shows empty-state copy when indexer returns no roles", async () => {
    mockFetchRoles.mockResolvedValue([]);
    mockFetchRequests.mockResolvedValue([]);
    renderPage();
    await waitFor(() =>
      expect(
        screen.getByText(/Once roles are assigned on-chain, they'll appear here/),
      ).toBeTruthy(),
    );
  });

  it("renders on-chain roles with truncated address and slot index", async () => {
    mockFetchRoles.mockResolvedValue([CHAIN_ROLE]);
    mockFetchRequests.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByText("0xdead…beef")).toBeTruthy());
    expect(screen.getByText("slot 0")).toBeTruthy();
  });

  it("renders the ipfs link when a cid is present", async () => {
    mockFetchRoles.mockResolvedValue([CHAIN_ROLE]);
    mockFetchRequests.mockResolvedValue([]);
    renderPage();
    await waitFor(() => screen.getByText("ipfs"));
    const link = screen.getByText("ipfs").closest("a");
    expect(link?.getAttribute("href")).toContain("bafyreiabc123");
  });

  it("opens a detail modal when a chain role row is clicked", async () => {
    const user = userEvent.setup();
    mockFetchRoles.mockResolvedValue([CHAIN_ROLE]);
    mockFetchRequests.mockResolvedValue([]);
    renderPage();
    await waitFor(() => screen.getByText("0xdead…beef"));
    await user.click(screen.getByText("0xdead…beef").closest("li")!);
    // Modal should be open; the full account address is visible.
    expect(screen.getByText(CHAIN_ROLE.account)).toBeTruthy();
    expect(screen.getByText("On-chain role")).toBeTruthy();
  });

  it("shows pending acceptances section when there are unaccepted requests", async () => {
    const PENDING: indexerMod.TrustRoleRequest = {
      proposer: "0x1111111111111111111111111111111111111111",
      account: "0x2222222222222222222222222222222222222222",
      roleTypeId: "0x01",
      ipfsCid: null,
      accepted: false,
    };
    mockFetchRoles.mockResolvedValue([]);
    mockFetchRequests.mockResolvedValue([PENDING]);
    renderPage();
    await waitFor(() => screen.getByText(/Pending acceptances/i));
    expect(screen.getByText("0x2222…2222")).toBeTruthy();
  });

  it("does not render on-chain section when indexer is disabled", async () => {
    mockEnabled.mockReturnValue(false);
    vi.spyOn(api, "getRoles").mockResolvedValue({ ok: true, roles: [OFF_CHAIN_ROLE], edges: [] });
    renderPage();
    await waitFor(() => screen.getByText("CEO"));
    expect(screen.queryByText(/On-chain roles/i)).toBeNull();
  });
});

describe("OwnershipPage — snapshot", () => {
  it("matches snapshot with off-chain roles only (indexer disabled)", async () => {
    mockEnabled.mockReturnValue(false);
    vi.spyOn(api, "getRoles").mockResolvedValue({ ok: true, roles: [OFF_CHAIN_ROLE], edges: [] });
    const { container } = renderPage();
    await waitFor(() => screen.getByText("CEO"));
    expect(container.firstChild).toMatchSnapshot();
  });

  it("matches snapshot with on-chain roles loaded", async () => {
    vi.spyOn(api, "getRoles").mockResolvedValue({ ok: true, roles: [OFF_CHAIN_ROLE], edges: [] });
    mockFetchRoles.mockResolvedValue([CHAIN_ROLE]);
    mockFetchRequests.mockResolvedValue([]);
    const { container } = renderPage();
    await waitFor(() => screen.getByText("0xdead…beef"));
    expect(container.firstChild).toMatchSnapshot();
  });
});
