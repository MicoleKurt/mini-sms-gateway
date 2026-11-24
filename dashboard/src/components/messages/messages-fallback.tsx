import { LoadingLabel } from "@/components/ui/skeleton";
import { Section } from "@/components/ui/section";
import { MessagesTable } from "./messages-table";
import { MessagesMargin } from "./messages-view";

/** Empty underlines where the filter fields will be, so the table does not jump when they come. */
const FIELD_PLACES = ["flex-[1.6]", "flex-1", "flex-1", "flex-[2]"];

/**
 * The Messages page before its filters are known. The filters live in the
 * URL, which only the browser reads, so this is what the prerendered HTML
 * shows until the page has hydrated.
 */
export function MessagesFallback() {
  return (
    <Section ruled={false} aside={<MessagesMargin tenants={undefined} />}>
      <h1 className="sr-only">Messages</h1>
      <LoadingLabel>Loading messages</LoadingLabel>
      <div aria-hidden className="flex h-[52px] items-end gap-7">
        {FIELD_PLACES.map((size, index) => (
          <span key={index} className={`h-8 border-b border-control-edge ${size}`} />
        ))}
      </div>
      <div className="mt-7 mb-2 min-h-9" />
      <MessagesTable messages={[]} listKey="" loading />
    </Section>
  );
}
