"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Shows a live value and flashes its ground for 120 ms when it changes (not
 * on first render). `value` is what is compared; `children` is what is shown
 * when it should be formatted: <LiveValue value={depth}><Count value={depth} /></LiveValue>.
 */
export function LiveValue({
  value,
  children,
  className,
}: {
  value: string | number;
  children?: ReactNode;
  className?: string;
}) {
  const [previous, setPrevious] = useState(value);
  const [changes, setChanges] = useState(0);
  if (value !== previous) {
    setPrevious(value);
    setChanges(changes + 1);
  }

  // A new key restarts the animation on every change.
  return (
    <span key={changes} className={cn(changes > 0 && "flash", className)}>
      {children ?? value}
    </span>
  );
}
