import { cn } from "@/lib/cn";

/** A placeholder block. Give it the size of the content it stands in for. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn("skeleton", className)} />;
}

/**
 * Says what is loading to assistive technology, which does not see the
 * skeleton blocks. Put it inside the region that is loading.
 */
export function LoadingLabel({ children }: { children: string }) {
  return (
    <span role="status" className="sr-only">
      {children}
    </span>
  );
}
