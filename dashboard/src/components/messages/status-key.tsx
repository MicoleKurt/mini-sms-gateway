import { MESSAGE_STATUSES, type MessageStatus } from "@/lib/status";
import { StatusWord } from "@/components/ui/status";

const MEANING: Record<MessageStatus, string> = {
  ACCEPTED: "passed checks, charged",
  QUEUED: "waiting for a submit slot",
  SUBMITTED: "with the carrier",
  DELIVERED: "reached the handset",
  UNDELIVERED: "carrier refused, charged",
  EXPIRED: "validity ran out, charged",
  FAILED: "rejected, refunded",
};

/** The status marks and what each status means, for the margin column. */
export function StatusKey({ className }: { className?: string }) {
  return (
    <div className={className}>
      <h2 id="status-key" className="lbl text-ink">
        Status key
      </h2>
      <dl aria-labelledby="status-key" className="mt-2 grid gap-y-2">
        {MESSAGE_STATUSES.map((status) => (
          <div key={status}>
            <dt>
              <StatusWord status={status} />
            </dt>
            {/* Indented to the word, past the 10 px mark and its 7 px gap. */}
            <dd className="pl-[17px] text-small text-ink-3">{MEANING[status]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
