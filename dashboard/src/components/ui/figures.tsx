import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { formatAmount, formatCount } from "@/lib/format";

/**
 * A figure an operator reads first, in tabular mono with its unit after it:
 * <Figure value="46.2" unit="/s mean" />. `size="mid"` is the 15 px figure
 * under it.
 */
export function Figure({
  value,
  unit,
  size = "large",
  className,
}: {
  value: ReactNode;
  unit?: ReactNode;
  size?: "large" | "mid";
  className?: string;
}) {
  return (
    <span className={cn(size === "large" ? "figure" : "figure-mid", className)}>
      {value}
      {unit ? <small>{unit}</small> : null}
    </span>
  );
}

/** A run of digits, with its sign and separators: "+971506701448", "1,310", "15:57:53.070". */
const NUMBER = /([+−-]?\d[\d.,:]*)/;

/**
 * A figure with its units on one line: the numbers in tabular mono, the
 * words between them ("s", "min", "ms", "USD") in the face of the sentence,
 * after an ordinary space. "9.222 s", "2 min 21 s". A mono space after a mono
 * figure reads as a double gap; this is why the unit is not mono.
 */
export function FigureText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn("whitespace-nowrap", className)}>
      {text.split(NUMBER).map((part, index) =>
        index % 2 === 1 ? (
          <span key={index} className="num">
            {part}
          </span>
        ) : part === "" ? null : (
          <span key={index} className="unit">
            {part}
          </span>
        ),
      )}
    </span>
  );
}

/**
 * An amount from micros, to 4 decimals so a column lines up on the point:
 * 239.9000. Add `currency` to set "USD" after it in ink-3.
 */
export function Money({
  micros,
  decimals = 4,
  currency,
  className,
}: {
  micros: number;
  decimals?: number;
  currency?: string;
  className?: string;
}) {
  if (!currency)
    return <span className={cn("num", className)}>{formatAmount(micros, decimals)}</span>;
  return (
    <span className="whitespace-nowrap">
      <span className={cn("num", className)}>{formatAmount(micros, decimals)}</span>{" "}
      <span className="text-ink-3">{currency}</span>
    </span>
  );
}

/** A count with thousands separators. A zero is dimmed so 0 / 0 / 0 recedes. */
export function Count({
  value,
  dimZero = true,
  className,
}: {
  value: number;
  dimZero?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("num", dimZero && value === 0 && "zero", className)}>
      {formatCount(value)}
    </span>
  );
}
