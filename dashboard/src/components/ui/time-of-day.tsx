import { cn } from "@/lib/cn";
import { timeOfDayParts } from "@/lib/format";

/**
 * A UTC time of day in mono, "16:13:35.412", with the milliseconds in ink-3.
 * The column head or the sentence around it says UTC.
 */
export function TimeOfDay({
  at,
  millis = true,
  className,
}: {
  /** An ISO timestamp or epoch milliseconds. */
  at: string | number;
  millis?: boolean;
  className?: string;
}) {
  const { clock, millis: fraction } = timeOfDayParts(at);
  const iso = typeof at === "string" ? at : new Date(at).toISOString();

  return (
    <time dateTime={iso} className={cn("num", className)}>
      {clock}
      {millis ? <span className="time-ms">{fraction}</span> : null}
    </time>
  );
}
