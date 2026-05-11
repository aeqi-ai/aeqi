import { useState } from "react";
import type { SingleBlueprint as Blueprint } from "@/lib/types";
import { countBlueprintStructures, describeBlueprintStructures } from "@/lib/blueprintStructures";
import { Button, Input, Select } from "@/components/ui";
import { WizardPanel } from "./WizardPanel";
import styles from "./WizardRolesPanel.module.css";

export interface RoleSeat {
  key: string;
  title: string;
  roleType: "founder" | "director" | "worker";
  /** "agent:<name>" | "user:<id>" | "vacant" */
  occupant: string;
  /** address shown as placeholder; null for agent seats */
  addressPlaceholder: string | null;
}

export interface InviteRow {
  email: string;
  roleType: "director" | "advisor" | "worker";
  /** True once the row has been submitted (sent invite stub). */
  sent?: boolean;
}

interface WizardRolesPanelProps {
  blueprint: Blueprint;
  userId: string | null;
  userName: string;
  seats: RoleSeat[];
  invites: InviteRow[];
  onSeatsChange: (next: RoleSeat[]) => void;
  onInvitesChange: (next: InviteRow[]) => void;
  expanded: boolean;
  onToggle: () => void;
  /** True for personal-os: single owner row, no invite flow */
  personalOs: boolean;
}

const ROLE_TYPE_OPTIONS = [
  { value: "director", label: "Director" },
  { value: "advisor", label: "Advisor" },
  { value: "worker", label: "Worker" },
];

/**
 * Roles panel — lists all seats from the blueprint, auto-populated.
 *
 * Founder/Director seats show the user's name. Agent seats show the agent name.
 * EOA address placeholder: "0x... — provisioned at create".
 * Hover-+ at the list footer adds an invite row (stub, no submit logic).
 */
export function WizardRolesPanel({
  blueprint,
  userId,
  userName,
  seats,
  invites,
  onSeatsChange: _onSeatsChange,
  onInvitesChange,
  expanded,
  onToggle,
  personalOs,
}: WizardRolesPanelProps) {
  const [hoveringAdd, setHoveringAdd] = useState(false);
  const structureCount = countBlueprintStructures(blueprint);

  const sentCount = invites.filter((r) => r.sent).length;
  const summary =
    `${seats.length} seat${seats.length !== 1 ? "s" : ""}` +
    (structureCount > 1 ? ` · ${structureCount} structures` : "") +
    (sentCount > 0 ? ` · ${sentCount} invite${sentCount !== 1 ? "s" : ""} queued` : "");

  function addInviteRow() {
    onInvitesChange([...invites, { email: "", roleType: "director" }]);
  }

  function updateInvite(idx: number, partial: Partial<InviteRow>) {
    const next = invites.map((row, i) => (i === idx ? { ...row, ...partial } : row));
    onInvitesChange(next);
  }

  function sendInvite(idx: number) {
    const row = invites[idx];
    if (!row || !row.email.trim()) return;
    updateInvite(idx, { sent: true });
  }

  function removeInvite(idx: number) {
    onInvitesChange(invites.filter((_, i) => i !== idx));
  }

  return (
    <WizardPanel
      id="wizard-roles"
      title="Roles"
      summary={summary}
      expanded={expanded}
      onToggle={onToggle}
    >
      <div className={styles.seatList}>
        {structureCount > 1 ? (
          <StructuredSeatList blueprint={blueprint} seats={seats} userName={userName} />
        ) : (
          seats.map((seat) => (
            <SeatRow key={seat.key} seat={seat} userId={userId} userName={userName} />
          ))
        )}

        {!personalOs &&
          invites.map((inv, idx) => (
            <InviteRowItem
              key={idx}
              invite={inv}
              onChange={(partial) => updateInvite(idx, partial)}
              onSend={() => sendInvite(idx)}
              onRemove={() => removeInvite(idx)}
            />
          ))}

        {!personalOs && (
          <button
            type="button"
            className={styles.addRow}
            onMouseEnter={() => setHoveringAdd(true)}
            onMouseLeave={() => setHoveringAdd(false)}
            onClick={addInviteRow}
          >
            <span className={styles.addIcon} aria-hidden="true">
              {hoveringAdd ? "+" : "+"}
            </span>
            <span className={styles.addLabel}>Invite co-director</span>
          </button>
        )}
      </div>
    </WizardPanel>
  );
}

interface StructuredSeatListProps {
  blueprint: Blueprint;
  seats: RoleSeat[];
  userName: string;
}

function StructuredSeatList({ blueprint, seats, userName }: StructuredSeatListProps) {
  const seatsByKey = new Map(seats.map((seat) => [seat.key, seat]));
  const structures = describeBlueprintStructures(blueprint);

  return (
    <>
      {structures.map((structure, idx) => (
        <section key={structure.id} className={styles.structureGroup}>
          <header className={styles.structureHead}>
            <span className={styles.structureEyebrow}>Structure {idx + 1}</span>
            <span className={styles.structureTitle}>{structure.title}</span>
            <span className={styles.structureMeta}>{structure.subtitle}</span>
          </header>
          <div className={styles.structureSeats}>
            {structure.roles.map((role) => {
              const seat = seatsByKey.get(role.key);
              if (!seat) return null;
              return <SeatRow key={seat.key} seat={seat} userId={null} userName={userName} />;
            })}
          </div>
        </section>
      ))}
    </>
  );
}

interface SeatRowProps {
  seat: RoleSeat;
  userId: string | null;
  userName: string;
}

function SeatRow({ seat, userId: _userId, userName }: SeatRowProps) {
  const isHumanSeat = seat.occupant.startsWith("user:");
  const isAgentSeat = seat.occupant.startsWith("agent:");
  const agentName = isAgentSeat ? seat.occupant.slice(6) : null;

  return (
    <div className={styles.seatRow}>
      <div className={styles.seatLeft}>
        <span className={styles.seatTitle}>{seat.title}</span>
        <span className={styles.seatType}>{seat.roleType}</span>
      </div>
      <div className={styles.seatOccupant}>
        {isHumanSeat ? (
          <>
            <span className={styles.occupantName}>{userName}</span>
            <span className={styles.occupantAddr}>0x... — provisioned at create</span>
          </>
        ) : isAgentSeat ? (
          <span className={styles.occupantAgent}>{agentName}</span>
        ) : (
          <span className={styles.occupantVacant}>Vacant</span>
        )}
      </div>
    </div>
  );
}

interface InviteRowItemProps {
  invite: InviteRow;
  onChange: (partial: Partial<InviteRow>) => void;
  onSend: () => void;
  onRemove: () => void;
}

function InviteRowItem({ invite, onChange, onSend, onRemove }: InviteRowItemProps) {
  if (invite.sent) {
    return (
      <div className={styles.inviteRow}>
        <div className={styles.inviteSentLabel}>
          {invite.email} · {invite.roleType} — queued
        </div>
        <button
          type="button"
          className={styles.removeInvite}
          onClick={onRemove}
          aria-label="Remove invite"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M2 2L10 10M10 2L2 10"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className={styles.inviteRow}>
      <div className={styles.inviteFields}>
        <Input
          placeholder="colleague@example.com"
          value={invite.email}
          onChange={(e) => onChange({ email: e.target.value })}
          size="sm"
        />
        <Select
          options={ROLE_TYPE_OPTIONS}
          value={invite.roleType}
          onChange={(v) => onChange({ roleType: v as "director" | "advisor" | "worker" })}
          size="sm"
        />
        <Button variant="secondary" size="sm" onClick={onSend} disabled={!invite.email.trim()}>
          Add
        </Button>
      </div>
      <button
        type="button"
        className={styles.removeInvite}
        onClick={onRemove}
        aria-label="Remove invite"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path
            d="M2 2L10 10M10 2L2 10"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
