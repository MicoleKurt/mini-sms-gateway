import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface SectionProps {
  /** The section name in the margin column. Leave it out rather than repeat the nav tab. */
  label?: ReactNode;
  /** One line of real context under the name: a snapshot time, a count, a source. */
  context?: ReactNode;
  /** Anything else for the margin column, under the context (a count, a key). */
  aside?: ReactNode;
  /** Opens the section with the 1.5 px ink rule. The first section of a page is usually not ruled. */
  ruled?: boolean;
  className?: string;
  /** Classes for the content column, for example a grid of its own. */
  bodyClassName?: string;
  children: ReactNode;
}

/**
 * A page section on the hanging grid: the name hangs in the 184 px margin
 * column and the content starts at the shared left edge. Under 768 px the
 * margin column stacks above the content.
 */
export function Section({
  label,
  context,
  aside,
  ruled = true,
  className,
  bodyClassName,
  children,
}: SectionProps) {
  const labelId = useId();

  return (
    <section
      aria-labelledby={label ? labelId : undefined}
      className={cn("sec", ruled && "sec-ruled", className)}
    >
      <div className="sec-h">
        {label ? (
          <h2 id={labelId} className="lbl">
            {label}
          </h2>
        ) : null}
        {context ? <div className="sec-context">{context}</div> : null}
        {aside}
      </div>
      <div className={cn("sec-b", bodyClassName)}>{children}</div>
    </section>
  );
}
