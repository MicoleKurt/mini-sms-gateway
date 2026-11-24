import { format, isSameDay } from "date-fns";
import { Coins, SendHorizontal, Smartphone, Webhook, type LucideIcon } from "lucide-react";
import { Children, type ReactNode } from "react";
import type { AttemptOutcome, DlrReceipt, WebhookDelivery } from "@/lib/api/schemas";
import { formatDateTime, formatDuration, formatMoney } from "@/lib/format";
import { Badge, StatusBadge } from "@/components/ui/badge";
import type { TimelineItem } from "./timeline-items";

type Tone = "neutral" | "ok" | "warn" | "danger";

// TIMEOUT and ABANDONED are warnings, not failures: the carrier may have accepted the message.
const OUTCOME_TONE: Record<AttemptOutcome, Tone> = {
  ACCEPTED: "ok",
  RATE_LIMITED: "warn",
  UNAVAILABLE: "warn",
  REJECTED: "danger",
  TIMEOUT: "warn",
  ABANDONED: "warn",
};

const DISPOSITION_TONE: Record<DlrReceipt["disposition"], Tone> = {
  APPLIED: "ok",
  PENDING: "neutral",
  IGNORED: "neutral",
};

const WEBHOOK_TONE: Record<WebhookDelivery["status"], Tone> = {
  DELIVERED: "ok",
  PENDING: "neutral",
  DEAD: "danger",
};

/**
 * A time of day. The date is written in front when the day is not the day of
 * `after`: the entry before this one, or the record this time belongs to.
 * `after` is null for the first entry, which always shows its date.
 */
function Clock({ at, after }: { at: string; after: string | null }) {
  const date = new Date(at);
  const sameDay = after !== null && isSameDay(date, new Date(after));
  return (
    <time dateTime={at} className="font-mono text-xs text-ink-faint">
      {format(date, sameDay ? "HH:mm:ss.SSS" : "yyyy-MM-dd HH:mm:ss.SSS")}
    </time>
  );
}

/** A list of small facts on one line, separated by dots. Empty values are left out. */
function Facts({ children }: { children: ReactNode }) {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-ink-muted">
      {Children.toArray(children).map((child, index) => (
        <span key={index} className="flex items-center gap-x-1.5">
          {index > 0 ? <span aria-hidden>·</span> : null}
          {child}
        </span>
      ))}
    </p>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono break-all">{children}</span>;
}

/** A record that is not a status change: smaller marker, neutral colour. */
function RecordNode({
  icon: Icon,
  at,
  previousAt,
  title,
  children,
}: {
  icon: LucideIcon;
  at: string;
  previousAt: string | null;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="relative flex gap-3 pb-4 pl-0.5">
      <span className="z-10 mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink-faint">
        <Icon aria-hidden className="size-3" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm text-ink">{title}</span>
          <Clock at={at} after={previousAt} />
        </div>
        {children}
      </div>
    </li>
  );
}

function StatusNode({
  item,
  previousAt,
}: {
  item: Extract<TimelineItem, { kind: "status" }>;
  previousAt: string | null;
}) {
  const details = Object.entries(item.event.detail);
  return (
    <li data-status={item.event.status} className="relative flex gap-3 pb-4">
      <span className="z-10 flex size-6 shrink-0 items-center justify-center rounded-full bg-status-tint ring-4 ring-surface">
        <span aria-hidden className="size-2.5 rounded-full bg-status" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <StatusBadge status={item.event.status} />
          {item.sincePreviousMs !== null ? (
            <span className="font-mono text-xs font-medium text-ink">
              +{formatDuration(item.sincePreviousMs)}
            </span>
          ) : null}
          <Clock at={item.at} after={previousAt} />
        </div>
        {details.length > 0 ? (
          <Facts>
            {details.map(([key, value]) => (
              <span key={key}>
                {key} <Mono>{typeof value === "string" ? value : JSON.stringify(value)}</Mono>
              </span>
            ))}
          </Facts>
        ) : null}
      </div>
    </li>
  );
}

/** `previousAt` is the time of the entry above, or null for the first one. */
function TimelineEntry({ item, previousAt }: { item: TimelineItem; previousAt: string | null }) {
  switch (item.kind) {
    case "status":
      return <StatusNode item={item} previousAt={previousAt} />;

    case "attempt": {
      const { attempt, durationMs } = item;
      return (
        <RecordNode
          icon={SendHorizontal}
          at={item.at}
          previousAt={previousAt}
          title={
            <span className="flex items-center gap-2">
              Submit attempt {attempt.attempt_no}
              {attempt.outcome ? (
                <Badge tone={OUTCOME_TONE[attempt.outcome]}>{attempt.outcome}</Badge>
              ) : (
                <Badge>IN FLIGHT</Badge>
              )}
            </span>
          }
        >
          <Facts>
            {attempt.http_status !== null && <span>HTTP {attempt.http_status}</span>}
            <span>
              worker <Mono>{attempt.worker_id}</Mono>
            </span>
            {durationMs !== null && <span>took {formatDuration(durationMs)}</span>}
            {attempt.carrier_id !== null && (
              <span>
                carrier ID <Mono>{attempt.carrier_id}</Mono>
              </span>
            )}
          </Facts>
          {attempt.error ? (
            <p className="mt-0.5 text-xs break-words text-danger-ink">{attempt.error}</p>
          ) : null}
        </RecordNode>
      );
    }

    case "dlr": {
      const { receipt } = item;
      return (
        <RecordNode
          icon={Smartphone}
          at={item.at}
          previousAt={previousAt}
          title={
            <span className="flex items-center gap-2">
              Delivery receipt <Mono>{receipt.status}</Mono>
              <Badge tone={DISPOSITION_TONE[receipt.disposition]}>{receipt.disposition}</Badge>
            </span>
          }
        >
          <Facts>
            <span>
              carrier time{" "}
              <time dateTime={receipt.carrier_timestamp} className="font-mono">
                {formatDateTime(receipt.carrier_timestamp)}
              </time>
            </span>
            <span>
              carrier ID <Mono>{receipt.carrier_id}</Mono>
            </span>
          </Facts>
        </RecordNode>
      );
    }

    case "ledger": {
      const { entry } = item;
      // Ledger amounts are signed as debits. The label already says which way the money went.
      const amount = formatMoney(Math.abs(entry.amount_micros));
      return (
        <RecordNode
          icon={Coins}
          at={item.at}
          previousAt={previousAt}
          title={
            <span>
              {entry.kind === "CHARGE" ? "Charged" : "Refunded"}{" "}
              <span className="font-mono font-medium">{amount}</span>
            </span>
          }
        >
          <Facts>
            <span>
              balance after <Mono>{formatMoney(entry.balance_after_micros)}</Mono>
            </span>
          </Facts>
        </RecordNode>
      );
    }

    case "webhook": {
      const { delivery } = item;
      return (
        <RecordNode
          icon={Webhook}
          at={item.at}
          previousAt={previousAt}
          title={
            <span className="flex items-center gap-2">
              Webhook
              <Badge tone={WEBHOOK_TONE[delivery.status]}>{delivery.status}</Badge>
            </span>
          }
        >
          <Facts>
            <span>{delivery.attempts === 1 ? "1 attempt" : `${delivery.attempts} attempts`}</span>
            {delivery.last_http_status !== null && <span>HTTP {delivery.last_http_status}</span>}
            {delivery.delivered_at !== null && (
              <span>
                delivered <Clock at={delivery.delivered_at} after={item.at} />
              </span>
            )}
            {delivery.status === "PENDING" && delivery.next_attempt_at !== null && (
              <span>
                next attempt <Clock at={delivery.next_attempt_at} after={item.at} />
              </span>
            )}
          </Facts>
          <p className="mt-0.5 font-mono text-xs break-all text-ink-faint">{delivery.url}</p>
          {delivery.last_error ? (
            <p className="mt-0.5 text-xs break-words text-danger-ink">{delivery.last_error}</p>
          ) : null}
        </RecordNode>
      );
    }
  }
}

/**
 * The full history of a message as a vertical timeline. Status changes are
 * the large coloured nodes. Attempts, receipts, ledger entries and webhooks
 * sit between them with their own icon, so the status path stays readable.
 */
export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="relative before:absolute before:top-2 before:bottom-6 before:left-[11px] before:w-px before:bg-line-strong">
      {items.map((item, index) => (
        <TimelineEntry key={item.key} item={item} previousAt={items[index - 1]?.at ?? null} />
      ))}
    </ol>
  );
}
