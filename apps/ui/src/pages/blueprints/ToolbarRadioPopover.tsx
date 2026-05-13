import { useState, type ReactElement } from "react";
import { Popover } from "@/components/ui";

export interface ToolbarRadioPopoverProps<T extends string> {
  label: string;
  current: string;
  glyph: ReactElement;
  options: { id: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}

export default function ToolbarRadioPopover<T extends string>({
  label,
  current,
  glyph,
  options,
  value,
  onChange,
}: ToolbarRadioPopoverProps<T>) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      trigger={
        <button
          type="button"
          className={`ideas-toolbar-btn${open ? " open" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`${label}: ${current}`}
          title={`${label}: ${current}`}
        >
          {glyph}
        </button>
      }
    >
      <div className="ideas-filter-popover" role="dialog" aria-label={label}>
        <header className="ideas-filter-popover-head">
          <span className="ideas-filter-popover-label">{label.toLowerCase()}</span>
        </header>
        <div className="ideas-filter-popover-list" role="radiogroup" aria-label={label}>
          {options.map((opt) => {
            const isActive = value === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={isActive}
                className={`ideas-filter-row${isActive ? " active" : ""}`}
                onClick={() => {
                  onChange(opt.id);
                  setOpen(false);
                }}
              >
                <span className="ideas-filter-row-label">{opt.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </Popover>
  );
}
