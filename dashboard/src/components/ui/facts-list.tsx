import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Key figures in a statement: label, dotted leader, value. Children are <Fact>s. */
export function FactsList({
  label,
  className,
  children,
}: {
  /** Names the list for assistive technology ("Key figures"). */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <ul aria-label={label} className={cn("leaders", className)}>
      {children}
    </ul>
  );
}

/**
 * One line of a <FactsList>. The value is mono; `words` sets it in sans
 * ("Balanced"). `attention` colours the value only, never the label.
 */
export function Fact({
  label,
  attention = false,
  words = false,
  note,
  children,
}: {
  label: ReactNode;
  attention?: boolean;
  words?: boolean;
  /** Small quiet words after the label, on the same line ("−86 in 60 s · live"). */
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <li>
      <span className="leader-k">
        {label}
        {note ? <span className="leader-note">{note}</span> : null}
      </span>
      <span aria-hidden className="leader-dots" />
      <span className={cn("leader-v", words && "is-words", attention && "attn")}>{children}</span>
    </li>
  );
}

/** The properties of one record as label and value rows. Children are <Property>s. */
export function PropertyList({ className, children }: { className?: string; children: ReactNode }) {
  return <dl className={cn("props", className)}>{children}</dl>;
}

export function Property({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}
