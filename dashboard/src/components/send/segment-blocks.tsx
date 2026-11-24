import type { Segment } from "@/lib/sms-encoding";

interface SegmentBlocksProps {
  segments: Segment[];
  /** Capacity of one segment at this segment count. */
  unitsPerSegment: number;
  unitName: string;
}

/** The text as the handset will receive it: one block per segment, so the split is visible. */
export function SegmentBlocks({ segments, unitsPerSegment, unitName }: SegmentBlocksProps) {
  return (
    <ol className="flex flex-col gap-2">
      {segments.map((segment, index) => (
        <li key={index} className="rounded-md border border-line bg-raised">
          <div className="flex items-center justify-between border-b border-line px-2.5 py-1 text-xs text-ink-muted">
            <span>
              Segment {index + 1} of {segments.length}
            </span>
            <span className="font-mono">
              {segment.units} / {unitsPerSegment} {unitName}
            </span>
          </div>
          <p className="px-2.5 py-2 font-mono text-xs leading-5 break-all whitespace-pre-wrap text-ink">
            {segment.text}
          </p>
        </li>
      ))}
    </ol>
  );
}
