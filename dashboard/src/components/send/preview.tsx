import type { UseQueryResult } from "@tanstack/react-query";
import type { Price, Tenant } from "@/lib/api/schemas";
import { splitSegments, type SmsAnalysis } from "@/lib/sms-encoding";
import type { PriceLookup } from "./price-lookup";
import { RateCard } from "./rate-card";
import { SegmentList } from "./segment-list";
import { Statement } from "./statement";
import { Ucs2Note } from "./ucs2-note";
import { explainUcs2 } from "./ucs2-cause";
import styles from "./send.module.css";

interface PreviewProps {
  /** The display sentence for the draft, from sendHeadline. */
  headline: string;
  text: string;
  to: string;
  analysis: SmsAnalysis;
  price: PriceLookup;
  prices: UseQueryResult<Price[]>;
  tenant: Tenant | undefined;
}

/**
 * What the gateway will make of the draft: the verdict, why it is UCS-2 if
 * it is, the cost as a statement, the split, and the rate card. Computed in
 * the browser on every keystroke; nothing is sent.
 */
export function Preview({ headline, text, to, analysis, price, prices, tenant }: PreviewProps) {
  const currency = tenant?.currency ?? "USD";
  const segments = splitSegments(text);
  const explanation = explainUcs2(text);
  const matched = price.state === "found" ? price.price : null;

  return (
    <section aria-labelledby="send-preview" className={styles.preview}>
      <p id="send-preview" className="lbl">
        Preview
      </p>
      {/* Announced politely, so a screen reader hears the verdict once typing pauses. */}
      <h1 aria-live="polite" aria-atomic className="headline">
        {headline}
      </h1>
      {explanation ? (
        <Ucs2Note
          explanation={explanation}
          analysis={analysis}
          pricePerSegment={matched?.price_per_segment_micros ?? null}
          currency={currency}
        />
      ) : null}
      {text === "" ? null : (
        <>
          <Statement analysis={analysis} segments={segments} price={price} tenant={tenant} />
          <SegmentList segments={segments} unitsPerSegment={analysis.unitsPerSegment} />
        </>
      )}
      <RateCard
        prices={prices}
        matched={matched}
        unmatched={price.state === "unsupported"}
        to={to}
        currency={currency}
      />
    </section>
  );
}
