import { describe, expect, it } from "vitest";
import type { SubmitAttempt } from "@/lib/api/schemas";
import { deliveredOnRetry, withChanges } from "./fixtures";
import { detailHeadline, journeyNote, summaryLine } from "./headline";
import { phraseText } from "./phrase";

const [refused, accepted] = deliveredOnRetry.attempts as [SubmitAttempt, SubmitAttempt];

const inFlight: SubmitAttempt = {
  ...accepted,
  finished_at: null,
  outcome: null,
  http_status: null,
  carrier_id: null,
};

const notFinal = { submitted_at: null, finalized_at: null, carrier_id: null };

describe("detailHeadline", () => {
  const text = (detail: Parameters<typeof detailHeadline>[0]) => phraseText(detailHeadline(detail));

  it("delivered: the time to the receipt and the attempt that worked", () => {
    expect(text(deliveredOnRetry)).toBe(
      "Delivered to +971506701448 in 9.17 s, on the second submit attempt.",
    );
    const firstTime = { ...accepted, attempt_no: 1 };
    expect(text(withChanges({ attempts: 1 }, { attempts: [firstTime] }))).toBe(
      "Delivered to +971506701448 in 9.17 s.",
    );
  });

  it("delivered: the verdict is its own piece and the figures are figures", () => {
    const pieces = detailHeadline(deliveredOnRetry);
    expect(pieces[0]).toEqual({ text: "Delivered", tone: "verdict" });
    expect(pieces.filter((piece) => piece.tone === "figure").map((piece) => piece.text)).toEqual([
      "+971506701448",
      "9.17 s",
    ]);
  });

  it("undelivered", () => {
    expect(text(withChanges({ status: "UNDELIVERED" }))).toBe(
      "Undelivered: the carrier could not deliver to +971506701448, reported 9.17 s after accept.",
    );
  });

  it("expired at the carrier, and expired because no receipt came", () => {
    expect(text(withChanges({ status: "EXPIRED" }))).toBe(
      "Expired: the validity of the message to +971506701448 ran out at the carrier, 9.17 s after accept.",
    );
    expect(text(withChanges({ status: "EXPIRED", failure_reason: "NO_DLR" }))).toBe(
      "Expired: no delivery receipt came for +971506701448 within 24 h of the submit.",
    );
  });

  it("failed: rejected by the carrier, with or without a refund", () => {
    const rejected: SubmitAttempt = {
      ...refused,
      outcome: "REJECTED",
      http_status: 400,
      error: "INVALID_DESTINATION",
    };
    const failed = withChanges(
      { status: "FAILED", failure_reason: "INVALID_DESTINATION", ...notFinal },
      { attempts: [rejected] },
    );
    expect(text(failed)).toBe(
      "Failed: the carrier rejected +971506701448 as INVALID_DESTINATION; the charge was not refunded.",
    );

    const refund = { ...deliveredOnRetry.ledger[0]!, id: 2, kind: "REFUND" as const };
    const refunded = { ...failed, ledger: [...failed.ledger, refund] };
    expect(text(refunded)).toBe(
      "Failed: the carrier rejected +971506701448 as INVALID_DESTINATION; the charge was refunded.",
    );
  });

  it("failed before any submit", () => {
    const failed = withChanges(
      { status: "FAILED", failure_reason: "NO_ROUTE", ...notFinal },
      { attempts: [] },
    );
    expect(text(failed)).toBe("Failed in the gateway with NO_ROUTE; the charge was not refunded.");
  });

  it("with the carrier", () => {
    const submitted = withChanges({ status: "SUBMITTED", finalized_at: null });
    expect(text(submitted)).toBe(
      "With the carrier since 15:57:53.850 UTC, waiting for the delivery receipt for +971506701448.",
    );
  });

  it("queued, waiting to retry, and submitting", () => {
    const queued = withChanges({ status: "QUEUED", ...notFinal }, { attempts: [] });
    expect(text(queued)).toBe("Queued since 15:57:53.070 UTC, waiting for a submit slot.");

    const retry = withChanges({ status: "QUEUED", ...notFinal }, { attempts: [refused] });
    expect(text(retry)).toBe("Waiting to retry after the carrier answered HTTP 503 to attempt 1.");

    const timedOut = { ...refused, outcome: "TIMEOUT" as const, http_status: null };
    expect(text(withChanges({ status: "QUEUED", ...notFinal }, { attempts: [timedOut] }))).toBe(
      "Waiting to retry after attempt 1 got no answer.",
    );

    const submitting = withChanges(
      { status: "QUEUED", ...notFinal },
      { attempts: [refused, inFlight] },
    );
    expect(text(submitting)).toBe("Submitting: attempt 2 to the carrier has no answer yet.");
  });

  it("accepted, not queued yet", () => {
    const accepted = withChanges({ status: "ACCEPTED", ...notFinal }, { attempts: [] });
    expect(text(accepted)).toBe("Accepted at 15:57:53.070 UTC, not queued yet.");
  });
});

describe("journeyNote", () => {
  it("names the refused submit and how much later the retry went", () => {
    expect(phraseText(journeyNote(deliveredOnRetry)!)).toBe(
      "The carrier refused the first submit with HTTP 503; the retry 303 ms later was accepted.",
    );
  });

  it("counts several refusals", () => {
    const second = {
      ...refused,
      attempt_no: 2,
      http_status: 429,
      outcome: "RATE_LIMITED" as const,
    };
    const third = { ...accepted, attempt_no: 3 };
    const note = journeyNote(withChanges({ attempts: 3 }, { attempts: [refused, second, third] }));
    expect(phraseText(note!)).toBe(
      "The carrier refused 2 submits (HTTP 503, HTTP 429); attempt 3 was accepted.",
    );
  });

  it("warns about a submit nobody answered", () => {
    const timedOut = { ...refused, outcome: "TIMEOUT" as const, http_status: null };
    const note = journeyNote(
      withChanges({ ambiguous_attempts: 1 }, { attempts: [timedOut, accepted] }),
    );
    expect(phraseText(note!)).toBe(
      "The first submit got no answer; the retry 303 ms later was accepted. A submit without an answer means the carrier may have taken the message twice.",
    );
  });

  it("puts a dead webhook in the attention ink", () => {
    const dead = { ...deliveredOnRetry.webhooks[0]!, status: "DEAD" as const, attempts: 6 };
    const note = journeyNote(
      withChanges({ attempts: 1 }, { attempts: [accepted], webhooks: [dead] }),
    );
    expect(phraseText(note!)).toBe("The tenant webhook is dead after 6 attempts.");
    expect(note!.find((piece) => piece.tone === "attention")?.text).toBe("dead after 6 attempts");
  });

  it("is null when nothing went wrong on the way", () => {
    expect(journeyNote(withChanges({ attempts: 1 }, { attempts: [accepted] }))).toBeNull();
  });
});

describe("summaryLine", () => {
  it("tenant, encoding, money and the webhook", () => {
    expect(phraseText(summaryLine(deliveredOnRetry))).toBe(
      "Acme Bank · GSM-7, 1 segment · charged 0.0210 USD · tenant webhook answered HTTP 200",
    );
  });

  it("says when there is no webhook, and leaves it out while the message is open", () => {
    expect(
      phraseText(summaryLine(withChanges({ segments: 3, encoding: "UCS2" }, { webhooks: [] }))),
    ).toBe("Acme Bank · UCS-2, 3 segments · charged 0.0210 USD · no tenant webhook");
    expect(phraseText(summaryLine(withChanges({ finalized_at: null }, { webhooks: [] })))).toBe(
      "Acme Bank · GSM-7, 1 segment · charged 0.0210 USD",
    );
  });
});
