"use client";

import { cn } from "@/lib/cn";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

/** An on/off control with its label. It is a real button with role="switch". */
export function Switch({ checked, onChange, label }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex h-8 items-center gap-2 rounded-md px-1 text-sm font-medium text-ink-muted hover:text-ink"
    >
      <span
        aria-hidden
        className={cn(
          "flex h-4 w-7 items-center rounded-full px-0.5 transition-colors",
          // The off track has to stand out from the page by itself (3:1), as the on track does.
          checked ? "bg-ok" : "bg-ink-faint",
        )}
      >
        <span
          className={cn(
            "size-3 rounded-full bg-surface shadow-sm transition-transform",
            checked && "translate-x-3",
          )}
        />
      </span>
      {label}
    </button>
  );
}
