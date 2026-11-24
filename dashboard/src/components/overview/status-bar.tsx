import { formatCount } from "@/lib/format";
import { MESSAGE_STATUSES, STATUS_LABEL, type StatusCounts } from "@/lib/status";

/**
 * A thin bar that shows the share of each status. Segments are separated by a
 * gap, not a border, and a status with no messages draws nothing. The numbers
 * themselves are in the grid under the bar and in the bar's accessible name.
 */
export function StatusBar({ counts, total }: { counts: StatusCounts; total: number }) {
  const present = MESSAGE_STATUSES.filter((status) => counts[status] > 0);
  const summary =
    total === 0
      ? "No messages yet"
      : present
          .map((status) => {
            const share = Math.round((counts[status] / total) * 100);
            return `${STATUS_LABEL[status]} ${formatCount(counts[status])} (${share}%)`;
          })
          .join(", ");

  return (
    <div
      role="img"
      aria-label={summary}
      className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-raised"
    >
      {present.map((status) => (
        <span
          key={status}
          data-status={status}
          className="min-w-0.5 bg-status transition-[flex-grow] duration-500"
          style={{ flexGrow: counts[status], flexBasis: 0 }}
        />
      ))}
    </div>
  );
}
