import type { ReactNode } from "react";
import type { Tenant } from "@/lib/api/schemas";
import { cn } from "@/lib/cn";
import type { Segment, SmsAnalysis } from "@/lib/sms-encoding";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/figures";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, Td, Tr } from "@/components/ui/table";
import type { PriceLookup } from "./price-lookup";
import { ENCODING_NAME, UNIT_NAME } from "./send-copy";
import styles from "./send.module.css";

function encodingNote({ encoding, segments, unitsPerSegment }: SmsAnalysis): string {
  const width = encoding === "GSM7" ? "7-bit" : "16-bit";
  const fit = segments === 1 ? "in one segment" : "per concatenated segment";
  return `${width}, ${unitsPerSegment} ${UNIT_NAME[encoding]} ${fit}`;
}

function spareNote(last: Segment | undefined, unitsPerSegment: number): string {
  const spare = unitsPerSegment - (last?.units ?? 0);
  return spare === 0 ? "the last segment is full" : `${spare} spare in the last segment`;
}

/** A value the statement can not give yet, with the reason in the note column. */
const UNKNOWN = <span className="zero">–</span>;

function Row({
  label,
  value,
  note,
  variant,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  variant?: "total";
}) {
  return (
    <Tr variant={variant}>
      <Td>{label}</Td>
      <Td numeric>{value}</Td>
      <Td className={styles.note}>{note}</Td>
    </Tr>
  );
}

function PriceNote({ price }: { price: PriceLookup }) {
  switch (price.state) {
    case "found":
      return (
        <>
          {price.price.prefix} {price.price.country}
        </>
      );
    case "loading":
      return "loading prices";
    case "error":
      return (
        <>
          Prices could not be loaded.{" "}
          <Button variant="quiet" onClick={price.retry}>
            Retry
          </Button>
        </>
      );
    case "unsupported":
      return <span className={styles.short}>no price for this destination</span>;
    case "no-destination":
      return "needs a valid destination";
  }
}

interface StatementProps {
  analysis: SmsAnalysis;
  segments: Segment[];
  price: PriceLookup;
  tenant: Tenant | undefined;
}

/**
 * What sending the draft costs, set as a statement: how it is encoded and
 * split, the price per segment and the prefix it came from, the total under
 * a double rule, and the balance before and after.
 */
export function Statement({ analysis, segments, price, tenant }: StatementProps) {
  const capacity = analysis.unitsPerSegment * analysis.segments;
  const perSegment = price.state === "found" ? price.price.price_per_segment_micros : null;
  const total = perSegment === null ? null : perSegment * analysis.segments;
  const after = total !== null && tenant ? tenant.balance_micros - total : null;

  return (
    <Table className={cn(styles.block, styles.statement)} aria-label="Cost of this message">
      <colgroup>
        <col className={styles.colLabel} />
        <col className={styles.colFigure} />
        <col />
      </colgroup>
      <tbody>
        <Row
          label="Encoding"
          value={ENCODING_NAME[analysis.encoding]}
          note={encodingNote(analysis)}
        />
        <Row
          label="Units used"
          value={`${analysis.units} / ${capacity}`}
          note={spareNote(segments.at(-1), analysis.unitsPerSegment)}
        />
        <Row
          label="Segments"
          value={analysis.segments}
          note={
            segments.length > 1 ? (
              <span className="num">{segments.map(({ units }) => units).join(" + ")}</span>
            ) : null
          }
        />
        <Row
          label="Price per segment"
          value={
            price.state === "loading" ? (
              <Skeleton className="ml-auto h-2.5 w-14" />
            ) : perSegment === null ? (
              UNKNOWN
            ) : (
              <Money micros={perSegment} />
            )
          }
          note={<PriceNote price={price} />}
        />
        <Row
          variant="total"
          label="Total"
          value={total === null ? UNKNOWN : <Money micros={total} />}
          note={tenant?.currency ?? "USD"}
        />
        <Row
          label="Balance now"
          value={tenant ? <Money micros={tenant.balance_micros} /> : UNKNOWN}
          note={tenant?.name}
        />
        <Row
          label="Balance after"
          value={
            after === null ? (
              UNKNOWN
            ) : (
              <Money micros={after} className={cn(styles.strong, after < 0 && styles.short)} />
            )
          }
          note={
            after !== null && after < 0 ? (
              <span className={styles.short}>not enough balance, the gateway will refuse it</span>
            ) : null
          }
        />
      </tbody>
    </Table>
  );
}
