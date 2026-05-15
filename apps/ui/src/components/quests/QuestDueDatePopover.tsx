import { useEffect, useId, useRef, useState } from "react";
import { Popover } from "../ui/Popover";
import { Button } from "../ui";
import { dueLabel, isOverdue } from "@/lib/format";
import { formatDateTime } from "@/lib/i18n";

export interface QuestDueDatePopoverProps {
  /** RFC3339 UTC string when set, null/undefined when no deadline. */
  due_at: string | null | undefined;
  /** RFC3339 UTC string to set, or `null` to clear. */
  onChange: (next: string | null) => void;
  /** Optional controlled-open. When provided, the parent owns the popover
   * state — used by the `D` keyboard shortcut on Quest detail to open
   * the picker without a click. Falls back to internal state otherwise. */
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
}

/**
 * QuestDueDatePopover — header-tier deadline picker. Three quick options
 * (Today, Tomorrow, Pick a date) plus a Clear row when a deadline is set.
 * Phase-2 simplicity: the "Pick a date" path uses a native
 * `<input type="date">`. A custom calendar widget is deferred until we
 * have a stronger reason to add a date dep — the native input renders
 * correctly across desktop browsers and matches the toolbar's chrome
 * tier visually.
 *
 * Mirrors `QuestStatusPopover` / `QuestPriorityPopover` for the
 * controlled-open opt-in (so the `D` shortcut on Quest detail can flip
 * it open without forking the component) and the
 * `.ideas-filter-popover` shell.
 */
export default function QuestDueDatePopover({
  due_at,
  onChange,
  open: openProp,
  onOpenChange: onOpenChangeProp,
}: QuestDueDatePopoverProps) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChangeProp?.(next);
  };
  const popoverId = useId();
  const dateInputRef = useRef<HTMLInputElement>(null);

  // When the user chose a custom date, we hold its `YYYY-MM-DD` value
  // here so the input renders the active day on re-open.
  const [customDate, setCustomDate] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    setCustomDate(due_at ? new Date(due_at).toISOString().slice(0, 10) : "");
  }, [open, due_at]);

  const overdue = isOverdue(due_at);
  const label = dueLabel(due_at);
  const triggerLabel = label || "Due";

  const commitDay = (offsetDays: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    // End-of-day in local time so "today" doesn't read as "overdue 8h"
    // mid-afternoon. The label layer day-aligns regardless, but ISO
    // round-trips that hit `dueLabel` from arbitrary clients land on
    // the right calendar day this way.
    d.setHours(23, 59, 59, 0);
    onChange(d.toISOString());
    setOpen(false);
  };

  const commitCustom = (yyyyMmDd: string) => {
    if (!yyyyMmDd) return;
    // Native `<input type="date">` returns `YYYY-MM-DD`. Anchor to
    // 23:59 local so the row reads as "due that day" not "due that
    // morning's midnight".
    const [y, m, d] = yyyyMmDd.split("-").map((s) => parseInt(s, 10));
    const local = new Date(y, m - 1, d, 23, 59, 59, 0);
    onChange(local.toISOString());
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      trigger={
        <Button
          variant="secondary"
          size="sm"
          className={`ideas-scope-btn quest-due-btn${open ? " open" : ""}${
            overdue ? " is-overdue" : ""
          }${due_at ? " is-set" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={popoverId}
          title={due_at ? `Due: ${formatDateTime(due_at)}` : "No due date"}
          leadingIcon={
            <svg
              width="13"
              height="13"
              viewBox="0 0 13 13"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <rect x="2.5" y="3" width="8" height="7.5" rx="1" />
              <path d="M2.5 5.5 H10.5" />
              <path d="M5 2 V4 M8 2 V4" />
            </svg>
          }
          trailingIconMode="inline"
          trailingIcon={
            <svg
              className="ideas-scope-btn-chevron"
              width="9"
              height="9"
              viewBox="0 0 9 9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M2 3.5 L4.5 6 L7 3.5" />
            </svg>
          }
        >
          {triggerLabel}
        </Button>
      }
    >
      <div id={popoverId} className="ideas-filter-popover ideas-scope-popover" role="dialog">
        <header className="ideas-filter-popover-head">
          <span className="ideas-filter-popover-label">due</span>
        </header>
        <div className="ideas-filter-popover-list" role="group" aria-label="Due date">
          <button type="button" className="ideas-filter-row" onClick={() => commitDay(0)}>
            <span className="ideas-filter-row-label">Today</span>
          </button>
          <button type="button" className="ideas-filter-row" onClick={() => commitDay(1)}>
            <span className="ideas-filter-row-label">Tomorrow</span>
          </button>
          <label className="ideas-filter-row quest-due-pick-row">
            <span className="ideas-filter-row-label">Pick a date</span>
            <input
              ref={dateInputRef}
              type="date"
              className="quest-due-pick-input"
              value={customDate}
              onChange={(e) => {
                setCustomDate(e.target.value);
                commitCustom(e.target.value);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          </label>
          {due_at && (
            <button
              type="button"
              className="ideas-filter-row quest-due-clear-row"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              <span className="ideas-filter-row-label">Clear</span>
            </button>
          )}
        </div>
      </div>
    </Popover>
  );
}
