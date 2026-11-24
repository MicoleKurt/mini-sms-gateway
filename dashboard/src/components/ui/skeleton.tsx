import { cn } from "@/lib/cn";

/** A placeholder block. Give it the size of the content it stands in for. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block bg-paper-sunk", className)} />;
}

const DEFAULT_WIDTHS = ["92%", "74%", "48%"];

/**
 * Lines of text that are still loading, sized by the font size around them:
 * inside a .headline they are display lines, inside a cell body lines. Static,
 * no shimmer. Pair with <LoadingLabel> or use <LoadingState>.
 */
export function SkeletonText({
  lines = 1,
  widths = DEFAULT_WIDTHS,
  className,
}: {
  lines?: number;
  widths?: readonly string[];
  className?: string;
}) {
  return (
    <span aria-hidden className={cn("block", className)}>
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} className="skel" style={{ width: widths[index % widths.length] }} />
      ))}
    </span>
  );
}

/**
 * Says what is loading to assistive technology, which does not see the
 * skeleton lines. Put it inside the region that is loading.
 */
export function LoadingLabel({ children }: { children: string }) {
  return (
    <span role="status" className="sr-only">
      {children}
    </span>
  );
}
