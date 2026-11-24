/**
 * The sentences at the top of a message's page. Each is a pure function of
 * the record, so every state has defined words and a test.
 *
 *   detailHeadline   what became of the message, by status:
 *                    delivered · undelivered · expired · failed · with the
 *                    carrier · submitting · waiting to retry · queued · accepted
 *   journeyNote      what went wrong on the way, or null when nothing did
 *   summaryLine      tenant · encoding and segments · money · webhook
 */
import type { LedgerEntry, MessageDetail, SubmitAttempt, WebhookDelivery } from "@/lib/api/schemas";
import { formatAmount, formatDuration } from "@/lib/format";
import {
  attention,
  code,
  figure,
  formatSeconds,
  joinWithDots,
  millisBetween,
  utcClock,
  words,
  type Phrase,
  type Piece,
} from "./phrase";

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];

const ENCODING_LABEL = { GSM7: "GSM-7", UCS2: "UCS-2" } as const;

function verdict(text: string): Piece {
  return { text, tone: "verdict" };
}

function byNumber(attempts: readonly SubmitAttempt[]): SubmitAttempt[] {
  return [...attempts].sort((a, b) => a.attempt_no - b.attempt_no);
}

function isRefused(attempt: SubmitAttempt): boolean {
  return attempt.outcome !== null && attempt.outcome !== "ACCEPTED";
}

/** An attempt the carrier never answered: it may have taken the message anyway. */
function gotNoAnswer(attempt: SubmitAttempt): boolean {
  return attempt.outcome === "TIMEOUT" || attempt.outcome === "ABANDONED";
}

/** How the carrier answered an attempt: "HTTP 503", with the code as a figure. */
function httpOf(attempt: SubmitAttempt): Piece[] {
  return attempt.http_status === null
    ? [code(attempt.outcome!)]
    : [words("HTTP "), figure(String(attempt.http_status))];
}

/** The time a message took to its final status: "9.17 s". */
function timeToFinal(detail: MessageDetail): Piece | null {
  const { created_at, finalized_at } = detail.message;
  return finalized_at === null
    ? null
    : figure(formatSeconds(millisBetween(created_at, finalized_at)));
}

function onAttempt(attemptNo: number): Piece[] {
  if (attemptNo <= 1) return [];
  const word = ORDINALS[attemptNo - 1];
  return [words(word ? `, on the ${word} submit attempt` : `, on submit attempt ${attemptNo}`)];
}

function acceptedAttemptNo(detail: MessageDetail): number {
  return (
    detail.attempts.find((attempt) => attempt.outcome === "ACCEPTED")?.attempt_no ??
    detail.message.attempts
  );
}

function expiredWithoutReceipt(detail: MessageDetail): boolean {
  return (
    detail.message.failure_reason === "NO_DLR" ||
    detail.events.some((event) => event.status === "EXPIRED" && event.detail.reason === "NO_DLR")
  );
}

function wasRefunded(ledger: readonly LedgerEntry[]): boolean {
  return ledger.some((entry) => entry.kind === "REFUND");
}

/** The one display sentence: what became of the message. */
export function detailHeadline(detail: MessageDetail): Phrase {
  const { message } = detail;
  const to = figure(message.to);
  const took = timeToFinal(detail);

  switch (message.status) {
    case "DELIVERED":
      return [
        verdict("Delivered"),
        words(" to "),
        to,
        ...(took ? [words(" in "), took] : []),
        ...onAttempt(acceptedAttemptNo(detail)),
        words("."),
      ];

    case "UNDELIVERED":
      return [
        verdict("Undelivered"),
        words(": the carrier could not deliver to "),
        to,
        ...(took ? [words(", reported "), took, words(" after accept")] : []),
        words("."),
      ];

    case "EXPIRED":
      if (expiredWithoutReceipt(detail)) {
        return [
          verdict("Expired"),
          words(": no delivery receipt came for "),
          to,
          words(" within 24 h of the submit."),
        ];
      }
      return [
        verdict("Expired"),
        words(": the validity of the message to "),
        to,
        words(" ran out at the carrier"),
        ...(took ? [words(", "), took, words(" after accept")] : []),
        words("."),
      ];

    case "FAILED": {
      const reason = message.failure_reason ?? byNumber(detail.attempts).at(-1)?.error ?? null;
      const refund = wasRefunded(detail.ledger)
        ? "; the charge was refunded."
        : "; the charge was not refunded.";
      if (detail.attempts.length === 0) {
        return [
          verdict("Failed"),
          words(" in the gateway"),
          ...(reason ? [words(" with "), code(reason)] : []),
          words(refund),
        ];
      }
      return [
        verdict("Failed"),
        words(": the carrier rejected "),
        to,
        ...(reason ? [words(" as "), code(reason)] : []),
        words(refund),
      ];
    }

    case "SUBMITTED":
      return [
        verdict("With the carrier"),
        ...(message.submitted_at
          ? [words(" since "), figure(utcClock(message.submitted_at)), words(" UTC")]
          : []),
        words(", waiting for the delivery receipt for "),
        to,
        words("."),
      ];

    case "QUEUED":
    case "ACCEPTED": {
      const last = byNumber(detail.attempts).at(-1);
      if (last && last.outcome === null) {
        return [
          verdict("Submitting"),
          words(": attempt "),
          figure(String(last.attempt_no)),
          words(" to the carrier has no answer yet."),
        ];
      }
      if (last && isRefused(last)) {
        return gotNoAnswer(last)
          ? [
              verdict("Waiting to retry"),
              words(" after attempt "),
              figure(String(last.attempt_no)),
              words(" got no answer."),
            ]
          : [
              verdict("Waiting to retry"),
              words(" after the carrier answered "),
              ...httpOf(last),
              words(" to attempt "),
              figure(String(last.attempt_no)),
              words("."),
            ];
      }
      const since = [figure(utcClock(message.created_at)), words(" UTC")];
      return message.status === "QUEUED"
        ? [verdict("Queued"), words(" since "), ...since, words(", waiting for a submit slot.")]
        : [verdict("Accepted"), words(" at "), ...since, words(", not queued yet.")];
    }
  }
}

function refusalSentence(refused: SubmitAttempt[], accepted: SubmitAttempt): Phrase {
  if (refused.length === 1) {
    const [first] = refused as [SubmitAttempt];
    const backoff = first.finished_at
      ? figure(formatDuration(millisBetween(first.finished_at, accepted.started_at)))
      : null;
    const retry = backoff
      ? [words("; the retry "), backoff, words(" later was accepted.")]
      : [words("; the retry was accepted.")];
    return gotNoAnswer(first)
      ? [words("The first submit got no answer"), ...retry]
      : [words("The carrier refused the first submit with "), ...httpOf(first), ...retry];
  }
  return [
    words(`The carrier refused ${refused.length} submits (`),
    ...refused.flatMap((attempt, index) => [
      ...(index > 0 ? [words(", ")] : []),
      ...httpOf(attempt),
    ]),
    words("); attempt "),
    figure(String(accepted.attempt_no)),
    words(" was accepted."),
  ];
}

function webhookSentence(webhook: WebhookDelivery | undefined): Phrase {
  if (webhook?.status === "DEAD") {
    return [
      words("The tenant webhook is "),
      attention(`dead after ${webhook.attempts} attempts`),
      words("."),
    ];
  }
  if (webhook?.status === "DELIVERED" && webhook.attempts > 1) {
    return [
      words("The tenant webhook answered on attempt "),
      figure(String(webhook.attempts)),
      words("."),
    ];
  }
  return [];
}

/**
 * What went wrong on the way to the outcome, in one or two sentences: refused
 * submits before the one the carrier took, a submit nobody answered, a
 * webhook that needed retries or died. Null when the way was clean.
 */
export function journeyNote(detail: MessageDetail): Phrase | null {
  const attempts = byNumber(detail.attempts);
  const accepted = attempts.find((attempt) => attempt.outcome === "ACCEPTED");
  const refused = attempts.filter(
    (attempt) => isRefused(attempt) && (!accepted || attempt.attempt_no < accepted.attempt_no),
  );

  const sentences: Phrase[] = [];
  if (accepted && refused.length > 0) sentences.push(refusalSentence(refused, accepted));
  if (detail.message.ambiguous_attempts > 0) {
    sentences.push([
      words("A submit without an answer means the carrier may have taken the message twice."),
    ]);
  }
  const webhook = webhookSentence(detail.webhooks.at(-1));
  if (webhook.length > 0) sentences.push(webhook);

  return sentences.length === 0
    ? null
    : sentences.flatMap((sentence, index) => (index === 0 ? sentence : [words(" "), ...sentence]));
}

function moneyPart(detail: MessageDetail): Phrase {
  const { cost_micros, currency } = detail.message;
  const verb = wasRefunded(detail.ledger) ? "charged and refunded " : "charged ";
  return [words(verb), figure(formatAmount(cost_micros)), words(` ${currency}`)];
}

function webhookPart(detail: MessageDetail): Phrase | null {
  const webhook = detail.webhooks.at(-1);
  if (!webhook) return detail.message.finalized_at === null ? null : [words("no tenant webhook")];
  switch (webhook.status) {
    case "DELIVERED":
      return [
        words(
          webhook.last_http_status === null
            ? "tenant webhook answered"
            : `tenant webhook answered HTTP ${webhook.last_http_status}`,
        ),
      ];
    case "PENDING":
      return [words("tenant webhook not answered yet")];
    case "DEAD":
      return [words("tenant webhook "), attention("dead")];
  }
}

/** The line under the headline: "Acme Bank · GSM-7, 1 segment · charged 0.0210 USD · ...". */
export function summaryLine(detail: MessageDetail): Phrase {
  const { message } = detail;
  const segments = message.segments === 1 ? "1 segment" : `${message.segments} segments`;
  const webhook = webhookPart(detail);
  return joinWithDots([
    [words(message.tenant_name)],
    [words(`${ENCODING_LABEL[message.encoding]}, ${segments}`)],
    moneyPart(detail),
    ...(webhook ? [webhook] : []),
  ]);
}
