import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import { MESSAGE_STATUSES, STATUS_LABEL, type StatusCounts } from "@/lib/status";
import { formatShare } from "./overview-format";
import styles from "./overview.module.css";

/** "Delivered 18,252 (89.1%), Undelivered 1,411 (6.9%), …" for the strip's accessible name. */
export function stripSummary(counts: StatusCounts, total: number): string {
  if (total === 0) return "No message records yet";
  return MESSAGE_STATUSES.filter((status) => counts[status] > 0)
    .map(
      (status) =>
        `${STATUS_LABEL[status]} ${formatCount(counts[status])} (${formatShare(counts[status], total)}%)`,
    )
    .join(", ");
}

/**
 * Message records by status as one proportional bar in the status inks, in
 * pipeline order. Flexbox does the proportions and holds every present
 * status at 3 px or more. Size it with `className`.
 */
export function StatusStrip({ counts, className }: { counts: StatusCounts; className?: string }) {
  const total = MESSAGE_STATUSES.reduce((sum, status) => sum + counts[status], 0);

  return (
    <div
      role="img"
      aria-label={stripSummary(counts, total)}
      className={cn(styles.strip, total === 0 && styles.stripEmpty, className)}
    >
      {MESSAGE_STATUSES.filter((status) => counts[status] > 0).map((status) => (
        <span
          key={status}
          data-status={status}
          className={styles.segment}
          style={{ flexGrow: counts[status] }}
        />
      ))}
    </div>
  );
}
