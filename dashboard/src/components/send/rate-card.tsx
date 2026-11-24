import type { UseQueryResult } from "@tanstack/react-query";
import type { Price } from "@/lib/api/schemas";
import { cn } from "@/lib/cn";
import { Money } from "@/components/ui/figures";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { NoteRow, Table, Td, Th, Tr } from "@/components/ui/table";
import styles from "./send.module.css";

interface RateCardProps {
  prices: UseQueryResult<Price[]>;
  /** The price the destination matched, if any. */
  matched: Price | null;
  /** True when the destination is a valid number that no prefix matches. */
  unmatched: boolean;
  to: string;
  currency: string;
}

/** Every priced prefix. The one the destination matched sits between ink rules, in bold, and says so. */
export function RateCard({ prices, matched, unmatched, to, currency }: RateCardProps) {
  return (
    <div className={styles.block}>
      <h2 id="send-rates" className={cn("lbl", styles.subhead)}>
        Rate card
      </h2>
      <Table aria-labelledby="send-rates" className={styles.rates}>
        <colgroup>
          <col className={styles.colPrefix} />
          <col />
          <col className={styles.colFigure} />
          <col className={styles.colNote} />
        </colgroup>
        <thead>
          <tr>
            <Th>Prefix</Th>
            <Th>Destination</Th>
            <Th numeric>Per segment</Th>
            <Th wideOnly>Match</Th>
          </tr>
        </thead>
        <tbody>
          {prices.isPending ? (
            <NoteRow colSpan={4}>
              <LoadingState label="Loading prices" lines={3} />
            </NoteRow>
          ) : prices.isError ? (
            <NoteRow colSpan={4}>
              <ErrorState
                title="Prices could not be loaded"
                error={prices.error}
                onRetry={() => prices.refetch()}
              />
            </NoteRow>
          ) : prices.data.length === 0 ? (
            <NoteRow colSpan={4}>
              <EmptyState
                title="The gateway has no prices."
                description="No destination can be sent to until one is added."
              />
            </NoteRow>
          ) : (
            prices.data.map((price) => {
              const isMatch = price.prefix === matched?.prefix;
              return (
                <Tr
                  key={price.prefix}
                  className={cn(isMatch && styles.matched)}
                  aria-current={isMatch ? "true" : undefined}
                >
                  <Td mono>{price.prefix}</Td>
                  <Td>{price.country}</Td>
                  <Td numeric>
                    <Money micros={price.price_per_segment_micros} />
                  </Td>
                  <Td wideOnly className={styles.note}>
                    {isMatch ? (
                      <>
                        matches <span className="num">{to}</span>
                      </>
                    ) : null}
                  </Td>
                </Tr>
              );
            })
          )}
        </tbody>
      </Table>
      <p className={cn(styles.note, "mt-1.5")}>
        {unmatched ? (
          <span className="attn">
            No prefix on this card matches <span className="num">{to}</span>.{" "}
          </span>
        ) : null}
        Prices in {currency}. The longest prefix a number starts with sets its price.
      </p>
    </div>
  );
}
