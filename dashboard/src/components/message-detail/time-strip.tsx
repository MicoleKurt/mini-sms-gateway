"use client";

import type { MessageDetail } from "@/lib/api/schemas";
import { useNow } from "@/lib/use-now";
import { FigureText } from "@/components/ui/figures";
import { Section } from "@/components/ui/section";
import { formatSecondsExact } from "./phrase";
import { phaseLabel, phaseNote, secondsTicks, timeSplit, type Phase } from "./time-split";

const FILL: Record<Phase, string> = {
  gateway: "bg-time-gateway",
  carrier: "bg-time-carrier",
  tenant: "bg-time-tenant",
};

function percent(ms: number, totalMs: number): string {
  return `${(ms / totalMs) * 100}%`;
}

/**
 * "Where the time went": the gateway, carrier and tenant spans of a message
 * drawn to scale on a seconds axis, each named under the strip. A span that
 * is still running grows with the clock.
 */
export function TimeStrip({ detail }: { detail: MessageDetail }) {
  const now = useNow(1_000);
  const { spans, totalMs } = timeSplit(detail, now);
  const scale = Math.max(totalMs, 1);
  const ticks = secondsTicks(scale);
  const last = spans.at(-1)!;
  const endsAt = last.open ? "now" : last.phase === "tenant" ? "webhook" : "final status";

  const summary = spans
    .map(
      (span) =>
        `${formatSecondsExact(span.endMs - span.startMs)} ${phaseLabel(span.phase, detail)}`,
    )
    .join(", ");

  return (
    <Section
      label="Where the time went"
      context={
        <>
          Accept to {endsAt}, <FigureText text={formatSecondsExact(totalMs)} />
        </>
      }
    >
      <figure className="m-0">
        <div role="img" aria-label={summary} className="relative h-3">
          {spans.map((span, index) => (
            <span
              key={span.phase}
              className={`absolute inset-y-0 min-w-[3px] ${FILL[span.phase]} ${index > 0 ? "border-l-2 border-paper" : ""}`}
              style={{
                left: percent(span.startMs, scale),
                width: percent(span.endMs - span.startMs, scale),
              }}
            />
          ))}
        </div>

        <div aria-hidden className="relative mt-0.5 h-5">
          {ticks.map((tick, index) => {
            const at = tick.ms / scale;
            const shift =
              index === 0 ? "translate-x-0" : at > 0.96 ? "-translate-x-full" : "-translate-x-1/2";
            return (
              <span
                key={tick.ms}
                className="absolute top-0 flex flex-col items-start"
                style={{ left: `${at * 100}%` }}
              >
                <span className="h-1 w-px bg-ink-3" />
                <span className={`num text-label leading-4 whitespace-nowrap text-ink-3 ${shift}`}>
                  {tick.label}
                </span>
              </span>
            );
          })}
        </div>

        <figcaption className="mt-3 flex flex-wrap justify-between gap-x-8 gap-y-3">
          {spans.map((span, index) => (
            <p
              key={span.phase}
              className={index > 0 && index === spans.length - 1 ? "sm:text-right" : undefined}
            >
              <span aria-hidden className={`mr-2 inline-block size-2 ${FILL[span.phase]}`} />
              <FigureText
                className="mr-2 text-lead font-medium"
                text={formatSecondsExact(span.endMs - span.startMs)}
              />
              <span className="text-ink-2">
                {phaseLabel(span.phase, detail)}
                {span.open ? ", so far" : ""}
              </span>
              <small className="block text-small text-ink-3">{phaseNote(span, detail)}</small>
            </p>
          ))}
        </figcaption>
      </figure>
    </Section>
  );
}
