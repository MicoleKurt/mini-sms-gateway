import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

interface TableProps extends HTMLAttributes<HTMLTableElement> {
  /** Classes for the scroll container, for example a max height. */
  containerClassName?: string;
}

/**
 * A real <table> inside its own scroll container. The container scrolls in
 * both directions, which is what lets the header row stay in view.
 */
export function Table({ containerClassName, className, ...props }: TableProps) {
  return (
    <div className={cn("overflow-auto", containerClassName)}>
      <table className={cn("w-full border-collapse text-left text-sm", className)} {...props} />
    </div>
  );
}

type Align = "left" | "right";

export function Th({
  align = "left",
  className,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { align?: Align }) {
  return (
    <th
      scope="col"
      className={cn(
        // The border is a shadow because a collapsed border does not travel with a sticky cell.
        "sticky top-0 z-10 h-9 bg-surface px-2 text-xs font-medium whitespace-nowrap text-ink-muted shadow-[inset_0_-1px_0_var(--line)] md:px-3",
        align === "right" && "text-right",
        className,
      )}
      {...props}
    />
  );
}

export function Td({
  align = "left",
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { align?: Align }) {
  return (
    <td
      className={cn(
        "h-10 px-2 whitespace-nowrap md:px-3",
        align === "right" && "text-right",
        className,
      )}
      {...props}
    />
  );
}
