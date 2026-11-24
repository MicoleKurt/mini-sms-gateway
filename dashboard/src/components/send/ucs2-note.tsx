import { Fragment } from "react";
import { cn } from "@/lib/cn";
import type { SmsAnalysis } from "@/lib/sms-encoding";
import { FigureText } from "@/components/ui/figures";
import { amountWords, segmentCount } from "./send-copy";
import { MAX_NAMED_CAUSES, type Ucs2Cause, type Ucs2Explanation } from "./ucs2-cause";
import styles from "./send.module.css";

function Cause({ cause, split }: { cause: Ucs2Cause; split: boolean }) {
  return (
    <>
      <mark className={styles.cause}>{cause.char}</mark>{" "}
      <span className="num">{cause.codePoint}</span> at character{" "}
      <span className="num">{cause.position}</span>
      {split ? <> in segment {cause.segment}</> : null}
      {cause.uses > 1 ? <>, used {cause.uses} times</> : null}
    </>
  );
}

function CauseList({ causes, split }: { causes: Ucs2Cause[]; split: boolean }) {
  return causes.map((cause, index) => (
    <Fragment key={cause.codePoint}>
      {index === 0 ? null : index === causes.length - 1 ? " and " : ", "}
      <Cause cause={cause} split={split} />
    </Fragment>
  ));
}

interface Ucs2NoteProps {
  explanation: Ucs2Explanation;
  analysis: SmsAnalysis;
  /** Price of one segment, when the destination has one. */
  pricePerSegment: number | null;
  currency: string;
}

/**
 * Why the text is UCS-2: each character that forces it, with its code point
 * and position, what that does to the segment size, and what the text would
 * cost without it.
 */
export function Ucs2Note({ explanation, analysis, pricePerSegment, currency }: Ucs2NoteProps) {
  const { causes, without } = explanation;
  const [first] = causes;
  const split = analysis.segments > 1;
  const capacity =
    analysis.segments === 1
      ? "a single segment holds 70 units instead of 160"
      : "every segment holds 67 units instead of 153";

  return (
    <div className={cn(styles.block, styles.ucs2)}>
      <span className={styles.ucs2Word}>UCS-2</span>
      <div>
        <p>
          {causes.length > MAX_NAMED_CAUSES && first ? (
            <>
              {causes.length} different characters are not in the GSM-7 alphabet, the first{" "}
              <Cause cause={first} split={split} />
            </>
          ) : (
            <>
              <CauseList causes={causes} split={split} /> {causes.length === 1 ? "is" : "are"} not
              in the GSM-7 alphabet
            </>
          )}
          , so {capacity}.
        </p>
        {without && without.units > 0 ? (
          <p>
            Without {causes.length === 1 ? "it" : "them"} this text is GSM-7 and fits in{" "}
            {segmentCount(without.segments)}
            {pricePerSegment === null ? null : (
              <>
                , <FigureText text={amountWords(pricePerSegment * without.segments, currency)} />{" "}
                instead of{" "}
                <FigureText text={amountWords(pricePerSegment * analysis.segments, currency)} />
              </>
            )}
            .
          </p>
        ) : null}
      </div>
    </div>
  );
}
