import { useState } from "react";
import { WizardPanel } from "./WizardPanel";
import { Button, Spinner } from "@/components/ui";
import type { IdentityState } from "./WizardIdentityPanel";
import type { RoleSeat, InviteRow } from "./WizardRolesPanel";
import type { TokenState } from "./WizardTokenPanel";
import type { VestingState } from "./WizardVestingPanel";
import type { GovernanceState } from "./WizardGovernancePanel";
import styles from "./WizardReviewPanel.module.css";

export interface WizardState {
  identity: IdentityState;
  seats: RoleSeat[];
  invites: InviteRow[];
  token: TokenState | null;
  vesting: VestingState | null;
  governance: GovernanceState | null;
}

interface WizardReviewPanelProps {
  state: WizardState;
  isValid: boolean;
  blueprintSlug: string;
  skipsStripe: boolean;
  founderFee: number;
  expanded: boolean;
  onToggle: () => void;
  onSubmit: () => Promise<void>;
}

/**
 * Naive keccak-like truncation for calldata preview display.
 *
 * We're not running ethers/viem here — just produce a legible deterministic
 * preview label. Real keccak runs server-side at create time.
 */
function previewHash(input: string): string {
  // Produce a short stable-looking hex from the input chars
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return "0x" + h.toString(16).padStart(8, "0") + "…";
}

/**
 * Review panel — summary + ABI-decoded calldata preview + wired Create CTA.
 */
export function WizardReviewPanel({
  state,
  isValid,
  blueprintSlug,
  skipsStripe,
  founderFee,
  expanded,
  onToggle,
  onSubmit,
}: WizardReviewPanelProps) {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const founderCount = state.seats.filter((s) => s.roleType === "founder").length;
  const directorCount = state.seats.filter((s) => s.roleType === "director").length;
  const workerCount = state.seats.filter((s) => s.roleType === "worker").length;
  const queuedInvites = state.invites.filter((r) => r.sent);
  const summary = `${state.identity.name || "Unnamed"} · ${state.seats.length} roles`;

  async function handleCreate() {
    setSubmitError(null);
    setSubmitting(true);
    try {
      await onSubmit();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Create failed. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Calldata preview construction ───────────────────────────────────
  const trustId = previewHash(`${blueprintSlug}:${state.identity.slug}`);
  const templateId = previewHash(blueprintSlug);
  const humanSeats = state.seats.filter((s) => s.occupant.startsWith("user:"));
  const declaredSigners = humanSeats.map((s) => s.occupant.replace("user:", ""));
  const roleCount = state.seats.length + queuedInvites.length;

  // Approx encoded byte count: trustId(32) + templateId(32) + ipfsCid(~68) +
  // signers(32 * count) + roles(~96 * count) + governance(~32)
  const approxBytes =
    32 + 32 + 68 + declaredSigners.length * 32 + roleCount * 96 + (state.governance ? 32 : 0);

  const ctaLabel = skipsStripe ? "Create company" : `Create company — $${founderFee} today`;

  return (
    <WizardPanel
      id="wizard-review"
      title="Review"
      summary={summary}
      expanded={expanded}
      onToggle={onToggle}
    >
      {/* ── What gets created ─────────────────────────────────── */}
      <div className={styles.summary}>
        <h3 className={styles.summaryHeading}>What gets created</h3>
        <div className={styles.summaryGrid}>
          <ReviewRow label="Company name" value={state.identity.name || "Not set"} />
          <ReviewRow label="Slug" value={state.identity.slug || "Not set"} />
          <ReviewRow label="Blueprint" value={blueprintSlug} />
          {founderCount > 0 && (
            <ReviewRow
              label="Founders"
              value={`${founderCount} seat${founderCount !== 1 ? "s" : ""}`}
            />
          )}
          {directorCount > 0 && (
            <ReviewRow
              label="Directors"
              value={`${directorCount} seat${directorCount !== 1 ? "s" : ""}`}
            />
          )}
          {workerCount > 0 && (
            <ReviewRow
              label="Workers"
              value={`${workerCount} seat${workerCount !== 1 ? "s" : ""}`}
            />
          )}
          {queuedInvites.length > 0 && (
            <ReviewRow
              label="Invites queued"
              value={`${queuedInvites.length} seat${queuedInvites.length !== 1 ? "s" : ""}`}
            />
          )}
          {state.token && (
            <>
              <ReviewRow label="Token" value={`${state.token.name} (${state.token.symbol})`} />
              <ReviewRow
                label="Max supply"
                value={Number(state.token.maxSupply || 0).toLocaleString()}
              />
            </>
          )}
          {state.vesting && (
            <ReviewRow
              label="Vesting"
              value={state.vesting.schedules
                .map((s) => `${s.roleType} ${s.durationYears}yr / ${s.cliffMonths}mo cliff`)
                .join(", ")}
            />
          )}
          {state.governance && (
            <ReviewRow
              label="Governance"
              value={`${state.governance.votingPeriodDays}d · ${state.governance.quorumPct}% quorum · ${state.governance.proposalThresholdPct}% threshold`}
            />
          )}
        </div>
      </div>

      {/* ── Calldata preview ──────────────────────────────────── */}
      <div className={styles.calldataSection}>
        <p className={styles.calldataLabel}>On-chain calldata (preview)</p>
        <div className={styles.calldataTable}>
          <CalldataRow field="Factory.registerTRUST()" value="" heading />
          <CalldataRow field="trustId" value={trustId} />
          <CalldataRow field="templateId" value={templateId} />
          <CalldataRow field="ipfsCid" value="pending — uploaded at create" />
          <CalldataRow
            field="declaredSigners"
            value={
              declaredSigners.length > 0
                ? `[${declaredSigners.map(() => "0x…provisioned").join(", ")}]`
                : "[]"
            }
          />
          <CalldataRow field="roleCount" value={String(roleCount)} />
          {state.token && (
            <>
              <CalldataRow field="token.name" value={state.token.name} />
              <CalldataRow field="token.symbol" value={state.token.symbol} />
              <CalldataRow
                field="token.maxSupply"
                value={`${Number(state.token.maxSupply || 0).toLocaleString()} (uint256)`}
              />
            </>
          )}
          {state.governance && (
            <>
              <CalldataRow
                field="governance.votingPeriod"
                value={`${state.governance.votingPeriodDays} days`}
              />
              <CalldataRow field="governance.quorum" value={`${state.governance.quorumPct}%`} />
              <CalldataRow
                field="governance.proposalThreshold"
                value={`${state.governance.proposalThresholdPct}%`}
              />
            </>
          )}
        </div>
        <p className={styles.calldataSize}>Approx. encoded size: ~{approxBytes} bytes</p>
      </div>

      {/* ── Create CTA ────────────────────────────────────────── */}
      <div className={styles.ctaSection}>
        {submitError && <p className={styles.submitError}>{submitError}</p>}
        <Button variant="primary" disabled={!isValid || submitting} onClick={handleCreate}>
          {submitting ? (
            <>
              <Spinner size="sm" />
              Creating…
            </>
          ) : (
            ctaLabel
          )}
        </Button>
        {!isValid && <p className={styles.ctaNote}>Set a company name to enable.</p>}
      </div>
    </WizardPanel>
  );
}

interface ReviewRowProps {
  label: string;
  value: string;
}

function ReviewRow({ label, value }: ReviewRowProps) {
  return (
    <div className={styles.reviewRow}>
      <span className={styles.reviewLabel}>{label}</span>
      <span className={styles.reviewValue}>{value}</span>
    </div>
  );
}

interface CalldataRowProps {
  field: string;
  value: string;
  heading?: boolean;
}

function CalldataRow({ field, value, heading = false }: CalldataRowProps) {
  return (
    <div className={heading ? styles.calldataHeadRow : styles.calldataRow}>
      <span className={styles.calldataField}>{field}</span>
      {!heading && <span className={styles.calldataValue}>{value}</span>}
    </div>
  );
}
