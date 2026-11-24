import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { Segment } from "@/lib/sms-encoding";
import { forcesUcs2 } from "./ucs2-cause";
import styles from "./send.module.css";

/**
 * Segment text in mono. A character that forces UCS-2 is marked; spaces at
 * the end are drawn as ␣ so a split right after a word is visible.
 */
function SegmentText({ text }: { text: string }) {
  const body = text.replace(/ +$/, "");
  const trailing = text.length - body.length;
  const parts: ReactNode[] = [];
  let run = "";
  for (const char of body) {
    if (!forcesUcs2(char)) {
      run += char;
      continue;
    }
    if (run) parts.push(run);
    run = "";
    parts.push(
      <mark key={parts.length} className={styles.cause}>
        {char}
      </mark>,
    );
  }
  if (run) parts.push(run);
  if (trailing > 0) {
    parts.push(
      <span key="trailing" aria-hidden className={styles.space}>
        {"␣".repeat(trailing)}
      </span>,
    );
  }
  return <p className={cn("num", styles.segmentText)}>{parts}</p>;
}

interface SegmentListProps {
  segments: Segment[];
  /** Capacity of one segment at this segment count. */
  unitsPerSegment: number;
}

/** The text as the handset receives it: one entry per segment, with a thin fill for the units it uses. */
export function SegmentList({ segments, unitsPerSegment }: SegmentListProps) {
  return (
    <div className={styles.block}>
      <h2 className={cn("lbl", styles.subhead)}>Split as sent</h2>
      <ol>
        {segments.map((segment, index) => {
          // The unit this segment starts at, counted from 1 over the whole message.
          const from = 1 + segments.slice(0, index).reduce((total, { units }) => total + units, 0);
          return (
            <li key={index} className={styles.segment}>
              <div className={styles.segmentHead}>
                <span className="lbl">Segment {index + 1}</span>
                <span className="num text-ink-2">
                  units {from}–{from + segment.units - 1}
                </span>
                <span className={styles.capacity}>
                  <span aria-hidden className={styles.meter}>
                    <span style={{ width: `${(segment.units / unitsPerSegment) * 100}%` }} />
                  </span>
                  <span aria-hidden className="num">
                    {segment.units}/{unitsPerSegment}
                  </span>
                  <span className="sr-only">
                    {segment.units} of {unitsPerSegment} units used
                  </span>
                </span>
              </div>
              <SegmentText text={segment.text} />
            </li>
          );
        })}
      </ol>
    </div>
  );
}
