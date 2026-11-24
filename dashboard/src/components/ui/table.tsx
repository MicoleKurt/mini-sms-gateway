import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

interface TableProps extends HTMLAttributes<HTMLTableElement> {
  /** Shorter rows (--row-pad-compact) for long lists. */
  compact?: boolean;
  /** Under 768 px the table scrolls sideways inside its wrapper. Pin the columns that must stay in view with <Td pin>. */
  scrollX?: boolean;
}

/**
 * A real <table>: baseline-aligned rows whose height comes from padding,
 * a caps head over an ink rule that sticks while the page scrolls, and
 * hairlines between rows. The outer cells sit on the section's edges.
 */
export function Table({ compact, scrollX, className, ...props }: TableProps) {
  return (
    <div className={cn("table-wrap", scrollX && "scroll-x")}>
      <table className={cn("t", compact && "t-compact", className)} {...props} />
    </div>
  );
}

interface CellOptions {
  /** A figure: mono, tabular, right-aligned. */
  numeric?: boolean;
  /** Stays in view while a scrollX table scrolls sideways (under 768 px). */
  pin?: boolean;
  /** Hidden under 768 px (for example Opening, Used and % on Tenants). */
  wideOnly?: boolean;
}

function cellClasses({ numeric, pin, wideOnly }: CellOptions, className?: string) {
  return cn(numeric && "r", pin && "pin", wideOnly && "hide-narrow", className);
}

/** A column head. `numeric` right-aligns it over its figures; the head stays in the label face. */
export function Th({
  numeric,
  pin,
  wideOnly,
  className,
  scope = "col",
  ...props
}: Omit<ThHTMLAttributes<HTMLTableCellElement>, "align"> & CellOptions) {
  return (
    <th scope={scope} className={cellClasses({ numeric, pin, wideOnly }, className)} {...props} />
  );
}

interface TdProps extends Omit<TdHTMLAttributes<HTMLTableCellElement>, "align">, CellOptions {
  /** Mono without right alignment: times, phone numbers, sender IDs. */
  mono?: boolean;
  /** The value is zero or does not apply: dimmed to ink-3. */
  zero?: boolean;
  /** Cut to the column width with an ellipsis. Give it a `title` with the full text. */
  clip?: boolean;
  /** Let the text wrap instead of keeping it on one line. */
  wrap?: boolean;
}

export function Td({
  numeric,
  pin,
  wideOnly,
  mono,
  zero,
  clip,
  wrap,
  className,
  ...props
}: TdProps) {
  return (
    <td
      className={cellClasses(
        { numeric, pin, wideOnly },
        cn((numeric || mono) && "num", zero && "zero", clip && "clip", wrap && "wrap", className),
      )}
      {...props}
    />
  );
}

interface TrProps extends HTMLAttributes<HTMLTableRowElement> {
  /** The row shown elsewhere on the page (the open message). Sunk ground and medium weight. */
  selected?: boolean;
  /** Sinks the row under the pointer. Use it when the row leads somewhere. */
  hoverable?: boolean;
  /** Fades the row in over 240 ms: set it on rows that arrived live. */
  arriving?: boolean;
  /** total: double rule above, closes a column of amounts. group: a date group. gap: a pause in a history. */
  variant?: "total" | "group" | "gap";
}

export function Tr({ selected, hoverable, arriving, variant, className, ...props }: TrProps) {
  return (
    <tr
      aria-current={selected ? "true" : undefined}
      data-selected={selected ? "" : undefined}
      className={cn(
        hoverable && "is-hoverable",
        arriving && "arrive",
        variant && `t-${variant}`,
        className,
      )}
      {...props}
    />
  );
}

/** One full-width line inside a table body: its empty, loading or error state. */
export function NoteRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr className="t-note">
      <td colSpan={colSpan}>{children}</td>
    </tr>
  );
}
