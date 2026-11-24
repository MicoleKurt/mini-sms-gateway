/**
 * Where a message's time went, as three spans from the moment the API
 * accepted it: in the gateway (until the carrier took it), with the carrier
 * (until the final status), and from the final status to the tenant's
 * webhook answering. A span that is still running ends at `now`.
 */
import type { MessageDetail } from "@/lib/api/schemas";
import { millisBetween } from "./phrase";

export type Phase = "gateway" | "carrier" | "tenant";

export interface TimeSpan {
  phase: Phase;
  /** Milliseconds after accept. */
  startMs: number;
  endMs: number;
  /** Still running: it ends at `now`, not at a recorded time. */
  open: boolean;
}

export interface TimeSplit {
  spans: TimeSpan[];
  totalMs: number;
}

export function timeSplit(detail: MessageDetail, now: number): TimeSplit {
  const { message } = detail;
  const accept = message.created_at;
  const nowIso = new Date(now).toISOString();
  const after = (iso: string) => Math.max(0, millisBetween(accept, iso));

  const spans: TimeSpan[] = [];
  // A message that never reached the carrier spent all its time in the gateway.
  const gatewayEnd = message.submitted_at ?? message.finalized_at;
  spans.push({
    phase: "gateway",
    startMs: 0,
    endMs: after(gatewayEnd ?? nowIso),
    open: gatewayEnd === null,
  });

  if (message.submitted_at !== null) {
    spans.push({
      phase: "carrier",
      startMs: after(message.submitted_at),
      endMs: after(message.finalized_at ?? nowIso),
      open: message.finalized_at === null,
    });
  }

  const webhook = detail.webhooks.at(-1);
  if (message.finalized_at !== null && webhook && webhook.status !== "DEAD") {
    spans.push({
      phase: "tenant",
      startMs: after(message.finalized_at),
      endMs: after(webhook.delivered_at ?? nowIso),
      open: webhook.delivered_at === null,
    });
  }

  return { spans, totalMs: Math.max(...spans.map((span) => span.endMs)) };
}

/** What a span is called under the strip: "in the gateway". */
export function phaseLabel(phase: Phase, detail: MessageDetail): string {
  switch (phase) {
    case "gateway":
      return "in the gateway";
    case "carrier":
      return "with the carrier";
    case "tenant":
      return detail.dlrs.length > 0 ? "receipt to tenant" : "status to tenant";
  }
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** The small line under a span's label: what happened in it. */
export function phaseNote(span: TimeSpan, detail: MessageDetail): string {
  const { message, attempts } = detail;
  switch (span.phase) {
    case "gateway": {
      const unanswered = attempts.filter(
        (a) => a.outcome === "TIMEOUT" || a.outcome === "ABANDONED",
      ).length;
      const refused = attempts.filter((a) => a.outcome !== null && a.outcome !== "ACCEPTED").length;
      const steps = ["accept", "charge"];
      if (!span.open && message.submitted_at === null) {
        steps.push(
          attempts.length > 0 ? "the carrier rejected the submit" : "failed before a submit",
        );
        return steps.join(", ");
      }
      if (refused > unanswered) steps.push(count(refused - unanswered, "refused submit"));
      if (unanswered > 0) steps.push(count(unanswered, "unanswered submit"));
      if (message.submitted_at !== null) steps.push(refused > 0 ? "retry" : "submit");
      else steps.push("waiting for a submit slot");
      return steps.join(", ");
    }
    case "carrier": {
      if (span.open) return "submitted, waiting for the delivery receipt";
      const receipt = detail.dlrs.at(-1);
      return receipt
        ? `submitted, until the ${receipt.status} receipt`
        : "submitted, no receipt came";
    }
    case "tenant": {
      if (span.open) return "status applied, webhook not answered yet";
      const tries = detail.webhooks.at(-1)?.attempts ?? 1;
      return tries > 1
        ? `status applied, webhook answered on attempt ${tries}`
        : "status applied, webhook answered";
    }
  }
}

export interface Tick {
  ms: number;
  label: string;
}

const STEPS = [1, 2, 5];

/**
 * Ticks for a seconds axis from 0 to `totalMs`: a round step (1, 2 or 5
 * times a power of ten) that gives at most `maxTicks` intervals. The last
 * label carries the unit.
 */
export function secondsTicks(totalMs: number, maxTicks = 10): Tick[] {
  const totalSeconds = Math.max(totalMs, 1) / 1_000;
  const raw = totalSeconds / maxTicks;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = STEPS.map((factor) => factor * power).find((s) => s >= raw) ?? 10 * power;
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));

  const ticks: Tick[] = [];
  for (let index = 0; index * step <= totalSeconds + step * 1e-9; index += 1) {
    const seconds = index * step;
    ticks.push({ ms: seconds * 1_000, label: seconds.toFixed(decimals) });
  }
  const last = ticks.at(-1)!;
  last.label = `${last.label} s`;
  return ticks;
}
