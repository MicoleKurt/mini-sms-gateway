"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Price, Tenant } from "@/lib/api/schemas";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";
import { findPrice } from "@/lib/pricing";
import { charactersForcingUcs2, splitSegments, type SmsAnalysis } from "@/lib/sms-encoding";
import { MAX_SEGMENTS } from "@/lib/validation";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SegmentBlocks } from "./segment-blocks";

export type PriceLookup =
  | { state: "loading" }
  | { state: "error"; retry: () => void }
  /** The destination is not a valid number yet, so there is nothing to look up. */
  | { state: "no-destination" }
  | { state: "unsupported" }
  | { state: "found"; price: Price };

/** Work out what the price row should say for this destination. */
export function lookUpPrice(
  prices: UseQueryResult<Price[]>,
  destination: string,
  destinationIsValid: boolean,
): PriceLookup {
  if (prices.isPending) return { state: "loading" };
  if (prices.isError) return { state: "error", retry: () => void prices.refetch() };
  if (!destinationIsValid) return { state: "no-destination" };
  const price = findPrice(prices.data, destination);
  return price ? { state: "found", price } : { state: "unsupported" };
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-4 border-b border-line py-1.5 last:border-b-0">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right font-mono text-ink">{children}</dd>
    </div>
  );
}

const PLACEHOLDER = <span className="font-sans text-ink-faint">Enter a destination</span>;

interface PreviewPanelProps {
  text: string;
  analysis: SmsAnalysis;
  price: PriceLookup;
  tenant: Tenant | undefined;
}

/**
 * What the gateway will make of the draft: encoding, segments and cost.
 * Everything here is computed in the browser on every keystroke.
 */
export function PreviewPanel({ text, analysis, price, tenant }: PreviewPanelProps) {
  const isUcs2 = analysis.encoding === "UCS2";
  const unitName = isUcs2 ? "UTF-16 units" : "septets";
  const capacity = analysis.unitsPerSegment * analysis.segments;
  const tooLong = analysis.segments > MAX_SEGMENTS;
  const forcing = isUcs2 ? charactersForcingUcs2(text) : [];

  const total =
    price.state === "found" ? price.price.price_per_segment_micros * analysis.segments : null;
  const balanceAfter = total !== null && tenant ? tenant.balance_micros - total : null;

  return (
    <Card aria-label="Preview">
      <CardHeader
        title="Preview"
        description="Computed in your browser as you type. Nothing is sent."
      />

      <dl className="px-4 pt-2 pb-1">
        <Row label="Encoding">
          <Badge tone={isUcs2 ? "warn" : "neutral"}>{isUcs2 ? "UCS-2" : "GSM-7"}</Badge>
        </Row>
        <Row label="Length">
          {analysis.units} / {capacity} {unitName}
        </Row>
        <Row label="Segments">
          <span className={cn(tooLong && "font-semibold text-danger-ink")}>
            {analysis.segments}
            {tooLong ? ` (limit ${MAX_SEGMENTS})` : ""}
          </span>
        </Row>
        <Row label="Price per segment">
          {price.state === "loading" ? (
            <Skeleton className="h-4 w-24" />
          ) : price.state === "error" ? (
            <span className="font-sans text-danger-ink">
              Prices could not be loaded.{" "}
              <button
                type="button"
                onClick={price.retry}
                className="font-medium underline underline-offset-2"
              >
                Retry
              </button>
            </span>
          ) : price.state === "unsupported" ? (
            <span className="font-sans font-medium text-danger-ink">
              No price for this destination
            </span>
          ) : price.state === "found" ? (
            <>
              {formatMoney(price.price.price_per_segment_micros)}
              <span className="ml-2 font-sans text-xs text-ink-muted">
                {price.price.country} ({price.price.prefix})
              </span>
            </>
          ) : (
            PLACEHOLDER
          )}
        </Row>
        <Row label="Total cost">{total !== null ? formatMoney(total) : PLACEHOLDER}</Row>
        <Row label="Balance after sending">
          {balanceAfter === null ? (
            PLACEHOLDER
          ) : (
            <span className={cn(balanceAfter < 0 && "font-semibold text-danger-ink")}>
              {formatMoney(balanceAfter, tenant?.currency)}
              {balanceAfter < 0 ? (
                <span className="ml-2 font-sans text-xs">not enough balance</span>
              ) : null}
            </span>
          )}
        </Row>
      </dl>

      {forcing.length > 0 ? (
        <div className="mx-4 mt-2 rounded-md border border-warn/40 bg-warn-tint px-3 py-2.5 text-xs text-warn-ink">
          <p>
            <span className="font-semibold">
              {forcing.length === 1 ? "This character is" : "These characters are"} not in the GSM-7
              alphabet.
            </span>{" "}
            The whole message is sent as UCS-2, which holds 70 units in one segment instead of 160.
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {forcing.map(({ char, codePoint }) => (
              <li
                key={codePoint}
                className="flex items-center gap-1.5 rounded border border-warn/40 bg-surface px-1.5 py-0.5"
              >
                <span className="min-w-3 text-center text-sm text-ink">{char}</span>
                <span className="font-mono text-ink-muted">{codePoint}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="p-4">
        <h3 className="mb-2 text-xs font-medium text-ink-muted">Segments as sent</h3>
        {text === "" ? (
          <p className="rounded-md border border-dashed border-line-strong px-3 py-6 text-center text-xs text-ink-faint">
            Type a message to see how it is split into segments.
          </p>
        ) : (
          <SegmentBlocks
            segments={splitSegments(text)}
            unitsPerSegment={analysis.unitsPerSegment}
            unitName={unitName}
          />
        )}
      </div>
    </Card>
  );
}
