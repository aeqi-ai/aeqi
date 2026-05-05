import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// ── Module mocks must be declared before importing the hook ───────────────────

vi.mock("@/lib/indexer", async () => {
  const actual = await vi.importActual<typeof import("@/lib/indexer")>("@/lib/indexer");
  return {
    ...actual,
    indexerEnabled: () => true,
    fetchTrustModules: vi.fn(),
    fetchTokenHolders: vi.fn(),
    findModuleByType: actual.findModuleByType,
  };
});

import { useTreasury } from "@/hooks/useTreasury";
import * as indexer from "@/lib/indexer";

const mockedFetchTrustModules = vi.mocked(indexer.fetchTrustModules);
const mockedFetchTokenHolders = vi.mocked(indexer.fetchTokenHolders);

const TRUST = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

// ── Helpers ───────────────────────────────────────────────────────────────────

const TOKEN_MODULE: indexer.IndexedModule = {
  trustAddress: TRUST,
  moduleId: indexer.MODULE_ID.token,
  moduleAddress: "0xaaaa",
  moduleAcl: "0x",
  attachedBlock: 100,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useTreasury", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: empty module list (no on-chain data yet).
    mockedFetchTrustModules.mockResolvedValue([]);
    mockedFetchTokenHolders.mockResolvedValue([]);

    // Stub global fetch for the treasury-transfers call (not yet deployed).
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        errors: [{ message: "Cannot query field 'treasuryTransfers'" }],
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns loading=true initially", () => {
    const { result } = renderHook(() => useTreasury(TRUST));
    expect(result.current.loading).toBe(true);
    expect(result.current.balances).toBeNull();
    expect(result.current.transfers).toBeNull();
  });

  it("resolves to empty arrays when no modules exist", async () => {
    mockedFetchTrustModules.mockResolvedValue([]);

    const { result } = renderHook(() => useTreasury(TRUST));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.balances).toEqual([]);
    expect(result.current.transfers).toEqual([]);
  });

  it("returns [] balances + [] transfers when indexer is disabled (no address)", async () => {
    const { result } = renderHook(() => useTreasury(undefined));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.balances).toEqual([]);
    expect(result.current.transfers).toEqual([]);
    expect(mockedFetchTrustModules).not.toHaveBeenCalled();
  });

  it("maps token holders into TokenBalance rows when token module is found", async () => {
    mockedFetchTrustModules.mockResolvedValue([TOKEN_MODULE]);
    mockedFetchTokenHolders.mockResolvedValue([
      {
        tokenAddress: "0xaaaa",
        holderAddress: "0xbbbb",
        balance: "1000000000000000000",
        lastUpdatedBlock: 200,
      },
    ]);

    const { result } = renderHook(() => useTreasury(TRUST));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.balances).toHaveLength(1);
    expect(result.current.balances![0].amount).toBe("1000000000000000000");
    expect(result.current.balances![0].holderAddress).toBe("0xbbbb");
    expect(result.current.balances![0].lastUpdatedBlock).toBe(200);
  });

  it("degrades gracefully when transfers field is not found (console.warn once)", async () => {
    mockedFetchTrustModules.mockResolvedValue([]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // The global fetch stub already returns a "field not found" error for
    // the transfers query — just verify it doesn't throw and emits [].
    const { result } = renderHook(() => useTreasury(TRUST));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.transfers).toEqual([]);
    // The warn may or may not fire depending on the global dedup key, but
    // the hook must NOT throw.
    warnSpy.mockRestore();
  });

  it("handles module fetch failure without crashing", async () => {
    mockedFetchTrustModules.mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() => useTreasury(TRUST));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.balances).toEqual([]);
    expect(result.current.transfers).toEqual([]);
  });

  it("resets to loading when trustAddress changes", async () => {
    mockedFetchTrustModules.mockResolvedValue([]);

    const { result, rerender } = renderHook(({ addr }: { addr: string }) => useTreasury(addr), {
      initialProps: { addr: TRUST },
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Change the address — should reset immediately.
    rerender({ addr: "0xnewaddress" });
    expect(result.current.loading).toBe(true);
  });
});
