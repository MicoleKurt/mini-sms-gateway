import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * A message ID as a real, underlined link (or plain text without `href`).
 *
 * `shared` is how many leading characters every ID in the same list has
 * (see sharedIdPrefix): they are set in ink-3, so the part that tells the
 * rows apart is the ink one. `shownLength` shortens the visible ID to that
 * many characters followed by an ellipsis; the rest stays in the text for
 * screen readers and for copying, and the full ID is in the title.
 */
export function MessageId({
  id,
  href,
  shared = 0,
  shownLength,
  className,
}: {
  id: string;
  href?: string;
  shared?: number;
  shownLength?: number;
  className?: string;
}) {
  const end = shownLength === undefined ? id.length : Math.min(shownLength, id.length);
  const cut = end < id.length;
  const text = (
    <>
      {/* The ellipsis is drawn by CSS, so a copied ID has none in it. */}
      <span className={cut ? "id-elided" : undefined}>
        {shared > 0 ? <span className="id-rest">{id.slice(0, Math.min(shared, end))}</span> : null}
        {id.slice(Math.min(shared, end), end)}
      </span>
      {cut ? <span className="sr-only">{id.slice(end)}</span> : null}
    </>
  );

  return href ? (
    <Link href={href} title={cut ? id : undefined} className={cn("num", className)}>
      {text}
    </Link>
  ) : (
    <span className={cn("num", className)}>{text}</span>
  );
}
