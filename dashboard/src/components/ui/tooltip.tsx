"use client";

import { useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Anchor {
  x: number;
  top: number;
  bottom: number;
}

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  /** Makes the trigger a tab stop. Use it when the trigger is not focusable itself. */
  focusable?: boolean;
  className?: string;
}

const EDGE_MARGIN = 8;
const HALF_MAX_WIDTH = 144;

/**
 * A tooltip for hover and keyboard focus.
 *
 * It renders into <body> with fixed coordinates, so a scrolling table or a
 * card with clipped overflow cannot cut it off. Escape hides it.
 */
export function Tooltip({ content, children, focusable = false, className }: TooltipProps) {
  const id = useId();
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  function show(element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    const centre = rect.left + rect.width / 2;
    const x = Math.min(
      Math.max(centre, EDGE_MARGIN + HALF_MAX_WIDTH),
      window.innerWidth - EDGE_MARGIN - HALF_MAX_WIDTH,
    );
    setAnchor({ x, top: rect.top, bottom: rect.bottom });
  }

  // Above the trigger, unless there is no room there.
  const above = anchor !== null && anchor.top > 72;

  return (
    <span
      className={className}
      tabIndex={focusable ? 0 : undefined}
      aria-describedby={anchor ? id : undefined}
      onMouseEnter={(event) => show(event.currentTarget)}
      onMouseLeave={() => setAnchor(null)}
      onFocus={(event) => show(event.currentTarget)}
      onBlur={() => setAnchor(null)}
      onKeyDown={(event) => {
        if (event.key === "Escape") setAnchor(null);
      }}
    >
      {children}
      {anchor
        ? createPortal(
            <span
              id={id}
              role="tooltip"
              style={{
                left: anchor.x,
                top: above ? anchor.top - 6 : anchor.bottom + 6,
                transform: above ? "translate(-50%, -100%)" : "translate(-50%, 0)",
              }}
              className="pointer-events-none fixed z-50 w-max max-w-72 animate-fade-in rounded-md bg-ink px-2 py-1.5 text-xs leading-4 text-canvas shadow-lg"
            >
              {content}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
