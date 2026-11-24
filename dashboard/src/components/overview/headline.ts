import type { Overview } from "@/lib/api/schemas";
import { formatCount, timeOfDayParts } from "@/lib/format";
import { formatAbout, formatRate, formatSetting, formatWait, joinNames } from "./overview-format";
import { summarizeThroughput } from "./throughput";

/** From this age on the oldest queued message is an attention value. */
export const BACKING_UP_AFTER_MS = 30_000;

/**
 * The seconds that say what the carrier is doing now. The 60 s mean is the
 * headline number, but it trails a change by up to a minute, so stopping,
 * running at the limit and a sudden change of pace are judged on these.
 */
export const RECENT_SECONDS = 10;

/** The recent rate is quoted beside the 60 s mean when they differ by more than this factor. */
const DIVERGENCE = 2;

/**
 * The states of the Overview headline, in priority order: the first that
 * applies is the one shown.
 *
 *   loading          no overview yet                  skeleton lines, no numbers
 *   unreachable      no answer, stream not live       says so, and when data was last seen
 *   ledger-mismatch  a balance does not reconcile     names the tenant
 *   stalled          queue > 0, no submits in 10 s    queue and oldest age
 *   backing-up       oldest queued > 30 s             the age is the attention value
 *   flowing          queue > 0, submits moving        rate against the limit, queue, age
 *   draining         queue empty, submits in flight   how many are still with the carrier
 *   idle             nothing queued, nothing in flight
 */
export type OverviewState =
  | "loading"
  | "unreachable"
  | "ledger-mismatch"
  | "stalled"
  | "backing-up"
  | "flowing"
  | "draining"
  | "idle";

/**
 * A piece of a sentence. Figures are set with tabular widths so the words
 * around them stay put when a live value changes; `attention` marks the one
 * value that crossed a threshold.
 */
export type SentencePart =
  | { kind: "verdict"; text: string }
  | { kind: "text"; text: string }
  | { kind: "figure"; text: string; attention?: boolean };

export interface Headline {
  state: OverviewState;
  /** The display sentence. Empty while loading. */
  sentence: SentencePart[];
  /** The line under it with what follows from the numbers. Empty while loading. */
  lede: SentencePart[];
}

export type HeadlineInput =
  | { kind: "loading" }
  /** `lastSeenAt` is when data last arrived (ISO), or null if none ever did. */
  | { kind: "unreachable"; lastSeenAt: string | null }
  | { kind: "data"; overview: Overview; tenantNames: ReadonlyMap<string, string> };

const verdict = (text: string): SentencePart => ({ kind: "verdict", text });
const text = (value: string): SentencePart => ({ kind: "text", text: value });
const figure = (value: string, attention = false): SentencePart =>
  attention ? { kind: "figure", text: value, attention } : { kind: "figure", text: value };

/** The sentence as plain text, for tests and for the screen reader summary. */
export function sentenceText(parts: readonly SentencePart[]): string {
  return parts.map((part) => part.text).join("");
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

function ledgerProblems(overview: Overview, names: ReadonlyMap<string, string>) {
  const nameOf = (id: string) => names.get(id) ?? id;
  const mismatched = overview.billing.filter((entry) => !entry.consistent);
  const doubled = overview.billing.filter((entry) => entry.double_charged > 0);
  return {
    mismatched: mismatched.map((entry) => nameOf(entry.tenant_id)),
    doubledTenants: doubled.map((entry) => nameOf(entry.tenant_id)),
    doubleCharges: doubled.reduce((sum, entry) => sum + entry.double_charged, 0),
  };
}

function ledgerSentence(problems: ReturnType<typeof ledgerProblems>): SentencePart[] {
  const doubled =
    problems.doubleCharges > 0
      ? [
          figure(formatCount(problems.doubleCharges), true),
          text(` ${plural(problems.doubleCharges, "message was", "messages were")} charged twice.`),
        ]
      : [];

  if (problems.mismatched.length > 0) {
    const their =
      problems.mismatched.length === 1
        ? "Its balance no longer equals"
        : "Their balances no longer equal";
    return [
      verdict(`Ledger mismatch for ${joinNames(problems.mismatched)}`),
      text(`. ${their} opening − charges + refunds.${doubled.length > 0 ? " " : ""}`),
      ...doubled,
    ];
  }
  return [
    verdict(`Double charges for ${joinNames(problems.doubledTenants)}`),
    text(": "),
    ...doubled,
  ];
}

/**
 * The submit rate as the sentence quotes it: the 60 s mean against the
 * limit, or, when the last seconds run at a very different pace, both rates
 * so the sentence does not trail what the chart shows. `unit` follows the
 * first figure ("submits/s" or "/s").
 */
function ratePhrase(overview: Overview, unit: string): SentencePart[] {
  const limit = overview.carrier.limit_per_second;
  const mean = summarizeThroughput(overview.throughput, limit).submitted.mean;
  const recent = summarizeThroughput(overview.throughput.slice(-RECENT_SECONDS), limit).submitted
    .mean;
  if (recent > mean * DIVERGENCE || recent < mean / DIVERGENCE) {
    return [
      figure(formatRate(recent)),
      text(`${unit} now, `),
      figure(formatRate(mean)),
      text("/s over the last minute"),
    ];
  }
  return [
    figure(formatRate(mean)),
    text(`${unit}, ${recent >= limit ? "at" : "inside"} the carrier’s `),
    figure(formatSetting(limit)),
    text("/s limit"),
  ];
}

/** What the queue and the carrier are doing, for every state below the ledger. */
function trafficSentence(overview: Overview): { state: OverviewState; parts: SentencePart[] } {
  const { depth, oldest_age_ms: oldest, in_flight: inFlight } = overview.queue;
  const limit = overview.carrier.limit_per_second;
  const summary = summarizeThroughput(overview.throughput, limit);
  const rate = summary.submitted.mean;
  const recentSubmits = summarizeThroughput(overview.throughput.slice(-RECENT_SECONDS), limit)
    .submitted.total;
  const queued = formatCount(depth);
  const backingUp = oldest > BACKING_UP_AFTER_MS;

  if (depth > 0 && recentSubmits === 0) {
    return {
      state: "stalled",
      parts: [
        verdict("Submits have stopped"),
        text(". "),
        figure(queued),
        text(
          ` ${plural(depth, "message is", "messages are")} queued and none went to the carrier in the last ${RECENT_SECONDS} s; the oldest has waited `,
        ),
        figure(formatWait(oldest), backingUp),
        text("."),
      ],
    };
  }

  if (depth > 0 && backingUp) {
    return {
      state: "backing-up",
      parts: [
        verdict("The queue is backing up"),
        text(": the oldest of "),
        figure(queued),
        text(` queued ${plural(depth, "message", "messages")} has waited `),
        figure(formatWait(oldest), true),
        text(". Submits run at "),
        ...ratePhrase(overview, "/s"),
        text("."),
      ],
    };
  }

  if (depth > 0) {
    return {
      state: "flowing",
      parts: [
        verdict("Traffic is flowing"),
        text(" at "),
        ...ratePhrase(overview, " submits/s"),
        text(". "),
        figure(queued),
        text(` ${plural(depth, "message is", "messages are")} queued and the oldest has waited `),
        figure(formatWait(oldest)),
        text("."),
      ],
    };
  }

  const lastMinute =
    summary.submitted.total > 0
      ? [text(" The last minute averaged "), figure(formatRate(rate)), text(" submits/s.")]
      : [];

  if (inFlight > 0) {
    return {
      state: "draining",
      parts: [
        verdict("The queue has drained"),
        text("; "),
        figure(formatCount(inFlight)),
        text(` ${plural(inFlight, "submit is", "submits are")} still with the carrier.`),
        ...lastMinute,
      ],
    };
  }

  return {
    state: "idle",
    parts: [
      verdict("Idle"),
      text(". Nothing is queued and nothing is with the carrier."),
      ...lastMinute,
    ],
  };
}

function tenantsPhrase(count: number): string {
  if (count === 1) return "the tenant";
  if (count === 2) return "both tenants";
  return `all ${formatCount(count)} tenants`;
}

/** Drain time, dead webhooks and the ledger: what an operator acts on next. */
function trafficLede(overview: Overview, state: OverviewState): SentencePart[] {
  const { depth } = overview.queue;
  const target = overview.carrier.target_per_second;
  const dead = overview.webhooks.dead;
  const parts: SentencePart[] = [];

  if (depth > 0 && state !== "stalled" && target > 0) {
    parts.push(
      text(`At the ${formatSetting(target)}/s target the queue drains in about `),
      figure(formatAbout(depth / target)),
      text(". "),
    );
  }

  if (dead > 0) {
    parts.push(
      figure(formatCount(dead), true),
      text(` webhook ${plural(dead, "delivery is", "deliveries are")} dead after retries`),
    );
  } else {
    parts.push(text("No webhook delivery is dead"));
  }

  const tenants = overview.billing.length;
  parts.push(text(tenants > 0 ? `; the ledger is balanced for ${tenantsPhrase(tenants)}.` : "."));
  return parts;
}

/** The Overview headline and lede for the current state. A pure function of its input. */
export function overviewHeadline(input: HeadlineInput): Headline {
  if (input.kind === "loading") return { state: "loading", sentence: [], lede: [] };

  if (input.kind === "unreachable") {
    const seen = input.lastSeenAt
      ? [
          text(". Data was last seen at "),
          figure(`${timeOfDayParts(input.lastSeenAt).clock} UTC`),
          text("."),
        ]
      : [text(". No data has arrived since this page opened.")];
    return {
      state: "unreachable",
      sentence: [verdict("The gateway is not answering"), ...seen],
      lede: [
        text(
          input.lastSeenAt
            ? "The figures below are from that moment and are not updating. The page keeps retrying on its own."
            : "The page keeps retrying on its own.",
        ),
      ],
    };
  }

  const { overview, tenantNames } = input;
  const traffic = trafficSentence(overview);
  const problems = ledgerProblems(overview, tenantNames);

  if (problems.mismatched.length > 0 || problems.doubleCharges > 0) {
    // The traffic still matters, so it moves to the lede, without its verdict weight.
    const trafficAsText = traffic.parts.map((part) =>
      part.kind === "verdict" ? text(part.text) : part,
    );
    return { state: "ledger-mismatch", sentence: ledgerSentence(problems), lede: trafficAsText };
  }

  return {
    state: traffic.state,
    sentence: traffic.parts,
    lede: trafficLede(overview, traffic.state),
  };
}
