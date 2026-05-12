import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { StackWizard, formatRelationship } from "@/components/StackWizard";
import { api } from "@/lib/api";
import type { StackBlueprint } from "@/lib/types";

const STACK: StackBlueprint = {
  kind: "stack",
  id: "holdco-portfolio",
  name: "Holdco Portfolio",
  tagline: "Parent entity with two subsidiaries.",
  description: "A holding company with two subsidiaries.",
  umbrella_slot: "holdco",
  component_count: 3,
  edge_count: 2,
  components: [
    { slot: "holdco", blueprint_id: "solo-founder", display_name_default: "HoldCo" },
    { slot: "sub-a", blueprint_id: "solo-founder", display_name_default: "Sub Alpha" },
    { slot: "sub-b", blueprint_id: "solo-founder", display_name_default: "Sub Beta" },
  ],
};

const renderWizard = (open = true, onClose = vi.fn()) =>
  render(
    <StrictMode>
      <MemoryRouter>
        <StackWizard stack={STACK} open={open} onClose={onClose} />
      </MemoryRouter>
    </StrictMode>,
  );

// ── formatRelationship helper unit tests ──────────────────────────────

describe("formatRelationship", () => {
  it("formats token_ownership with percent_bps", () => {
    expect(formatRelationship({ type: "token_ownership", percent_bps: 2000 })).toBe(
      "20% token ownership",
    );
  });

  it("formats role_assignment with role_type", () => {
    expect(formatRelationship({ type: "role_assignment", role_type: "director" })).toBe(
      "director role assignment",
    );
  });

  it("formats treasury_flow with amount_usd", () => {
    expect(formatRelationship({ type: "treasury_flow", amount_usd: 500 })).toBe(
      "treasury flow $5.00/period",
    );
  });

  it("falls back to humanizing the type string", () => {
    expect(formatRelationship({ type: "custom_link" })).toBe("custom link");
  });
});

// ── StackWizard happy-path integration tests ──────────────────────────

describe("StackWizard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders rename step with component inputs on open", async () => {
    renderWizard();

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: /name your companies/i }),
    ).toBeInTheDocument();

    // All three component slots should have labeled inputs.
    expect(screen.getByLabelText("holdco")).toBeInTheDocument();
    expect(screen.getByLabelText("sub-a")).toBeInTheDocument();
    expect(screen.getByLabelText("sub-b")).toBeInTheDocument();

    // Review button present but the form is prefilled so it's enabled.
    expect(screen.getByRole("button", { name: /review/i })).toBeInTheDocument();
  });

  it("does not render when open=false", () => {
    renderWizard(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("advances to review step on 'Review →' click", async () => {
    const user = userEvent.setup();
    renderWizard();

    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: /review/i }));

    expect(
      await screen.findByRole("heading", { level: 2, name: /review before deploying/i }),
    ).toBeInTheDocument();

    // Review step lists all company names.
    expect(screen.getByText("HoldCo")).toBeInTheDocument();
    expect(screen.getByText("Sub Alpha")).toBeInTheDocument();
    expect(screen.getByText("Sub Beta")).toBeInTheDocument();
  });

  it("can navigate back from review to rename", async () => {
    const user = userEvent.setup();
    renderWizard();

    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: /review/i }));
    await screen.findByRole("heading", { level: 2, name: /review before deploying/i });

    await user.click(screen.getByRole("button", { name: /back/i }));

    expect(
      await screen.findByRole("heading", { level: 2, name: /name your companies/i }),
    ).toBeInTheDocument();
  });

  it("happy path: spawn succeeds and shows success step", async () => {
    const user = userEvent.setup();

    vi.spyOn(api, "startStack").mockResolvedValue({
      ok: true,
      stack_id: "test-stack-run-1",
      components: [
        { slot: "holdco", status: "ok", entity_id: "ent-holdco-1", trust_address: "0xabc123" },
        { slot: "sub-a", status: "ok", entity_id: "ent-sub-a-1" },
        { slot: "sub-b", status: "ok", entity_id: "ent-sub-b-1" },
      ],
      edge_results: [
        {
          from_slot: "holdco",
          to_slot: "sub-a",
          relationship_type: "token_ownership",
          status: "ok",
        },
        {
          from_slot: "holdco",
          to_slot: "sub-b",
          relationship_type: "token_ownership",
          status: "ok",
        },
      ],
    });

    renderWizard();
    await screen.findByRole("dialog");

    // Advance through rename → review → deploy.
    await user.click(screen.getByRole("button", { name: /review/i }));
    await screen.findByRole("heading", { level: 2, name: /review before deploying/i });
    await user.click(screen.getByRole("button", { name: /deploy stack/i }));

    // Success step.
    expect(
      await screen.findByRole("heading", { level: 2, name: /stack deployed/i }),
    ).toBeInTheDocument();

    // Entities are listed.
    expect(screen.getByText("ent-holdco-1")).toBeInTheDocument();
    expect(screen.getByText("ent-sub-a-1")).toBeInTheDocument();
    expect(screen.getByText("ent-sub-b-1")).toBeInTheDocument();

    // Confirm api.startStack was called with the stack id and default names.
    expect(api.startStack).toHaveBeenCalledWith({
      stack_id: "holdco-portfolio",
      names: { holdco: "HoldCo", "sub-a": "Sub Alpha", "sub-b": "Sub Beta" },
    });

    // Done button is present.
    expect(screen.getByRole("button", { name: /done/i })).toBeInTheDocument();
  });

  it("shows error step when api.startStack rejects", async () => {
    const user = userEvent.setup();

    vi.spyOn(api, "startStack").mockRejectedValue(new Error("insufficient funds"));

    renderWizard();
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: /review/i }));
    await screen.findByRole("heading", { level: 2, name: /review before deploying/i });
    await user.click(screen.getByRole("button", { name: /deploy stack/i }));

    // Error step surfaces the message.
    expect(
      await screen.findByRole("heading", { level: 2, name: /deployment failed/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("insufficient funds");

    // Retry button present.
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("retry sends the wizard back to review", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "startStack").mockRejectedValue(new Error("timeout"));

    renderWizard();
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: /review/i }));
    await user.click(screen.getByRole("button", { name: /deploy stack/i }));
    await screen.findByRole("heading", { level: 2, name: /deployment failed/i });

    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(
      await screen.findByRole("heading", { level: 2, name: /review before deploying/i }),
    ).toBeInTheDocument();
  });

  it("name edits flow through to the startStack call", async () => {
    const user = userEvent.setup();

    vi.spyOn(api, "startStack").mockResolvedValue({
      ok: true,
      stack_id: "holdco-portfolio",
      components: [{ slot: "holdco", status: "ok", entity_id: "ent-1" }],
      edge_results: [],
    });

    renderWizard();
    await screen.findByRole("dialog");

    // Rename the holdco slot.
    const holdcoInput = screen.getByLabelText("holdco");
    fireEvent.change(holdcoInput, { target: { value: "Acme Corp" } });
    expect((holdcoInput as HTMLInputElement).value).toBe("Acme Corp");

    await user.click(screen.getByRole("button", { name: /review/i }));
    await user.click(screen.getByRole("button", { name: /deploy stack/i }));

    await waitFor(() => {
      expect(api.startStack).toHaveBeenCalledWith(
        expect.objectContaining({ names: expect.objectContaining({ holdco: "Acme Corp" }) }),
      );
    });
  });
});
