/**
 * The message state machine, in pipeline order.
 *
 * Status colours are CSS tokens (see globals.css). An element with
 * `data-status="QUEUED"` gets that status's colours for itself and its
 * children, so every badge, bar and timeline node uses the same source.
 */
export const MESSAGE_STATUSES = [
  "ACCEPTED",
  "QUEUED",
  "SUBMITTED",
  "DELIVERED",
  "UNDELIVERED",
  "EXPIRED",
  "FAILED",
] as const;

export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export type StatusCounts = Record<MessageStatus, number>;

export const STATUS_LABEL: Record<MessageStatus, string> = {
  ACCEPTED: "Accepted",
  QUEUED: "Queued",
  SUBMITTED: "Submitted",
  DELIVERED: "Delivered",
  UNDELIVERED: "Undelivered",
  EXPIRED: "Expired",
  FAILED: "Failed",
};

export const STATUS_DESCRIPTION: Record<MessageStatus, string> = {
  ACCEPTED: "Validated and charged",
  QUEUED: "Waiting to be sent",
  SUBMITTED: "With the carrier",
  DELIVERED: "Reached the handset",
  UNDELIVERED: "Could not be delivered",
  EXPIRED: "Validity period ran out",
  FAILED: "Refused by the carrier",
};

export function emptyCounts(): StatusCounts {
  return {
    ACCEPTED: 0,
    QUEUED: 0,
    SUBMITTED: 0,
    DELIVERED: 0,
    UNDELIVERED: 0,
    EXPIRED: 0,
    FAILED: 0,
  };
}

export function sumCounts(all: StatusCounts[]): StatusCounts {
  const total = emptyCounts();
  for (const counts of all) {
    for (const status of MESSAGE_STATUSES) total[status] += counts[status];
  }
  return total;
}

// The four final statuses share a rank: none of them comes after another.
const STATUS_RANK: Record<MessageStatus, number> = {
  ACCEPTED: 0,
  QUEUED: 1,
  SUBMITTED: 2,
  DELIVERED: 3,
  UNDELIVERED: 3,
  EXPIRED: 3,
  FAILED: 3,
};

/** How far along the pipeline a status is. A message never moves to a lower rank. */
export function statusRank(status: MessageStatus): number {
  return STATUS_RANK[status];
}
