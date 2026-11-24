"use client";

import { cn } from "@/lib/cn";

export interface Preset<Value extends string> {
  value: Value;
  label: string;
}

interface PresetGroupProps<Value extends string> {
  /** Names the group for assistive technology ("Time range", "Theme"). */
  label: string;
  options: readonly Preset<Value>[];
  /** The current preset, or null when none is (custom From/To values, or before hydration). */
  value: Value | null;
  onChange: (value: Value) => void;
  className?: string;
}

/**
 * A row of presets of which one is current: the range presets next to
 * From/To, the theme switch. Each is a button with aria-pressed; the current
 * one sits on --paper-sunk in medium weight.
 */
export function PresetGroup<Value extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: PresetGroupProps<Value>) {
  return (
    <div role="group" aria-label={label} className={cn("presets", className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="preset"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
