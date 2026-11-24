import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { LoadingLabel, Skeleton } from "@/components/ui/skeleton";
import { MessagesTable } from "./messages-table";

/**
 * The Messages page before its filters are known. The filters live in the
 * URL, which only the browser reads, so this is what the prerendered HTML
 * shows until the page has hydrated.
 */
export function MessagesFallback() {
  return (
    <>
      <PageHeader
        title="Messages"
        description="Every message of every tenant, newest first. Open a row for its full history."
      />
      <Card>
        <LoadingLabel>Loading messages…</LoadingLabel>
        <div className="border-b border-line p-3">
          <Skeleton className="h-8 w-full sm:w-72" />
        </div>
        <MessagesTable messages={[]} loading />
        <div className="min-h-12 border-t border-line" />
      </Card>
    </>
  );
}
