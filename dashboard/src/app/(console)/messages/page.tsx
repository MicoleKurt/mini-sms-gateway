import type { Metadata } from "next";
import { Suspense } from "react";
import { MessagesFallback } from "@/components/messages/messages-fallback";
import { MessagesView } from "@/components/messages/messages-view";

export const metadata: Metadata = { title: "Messages" };

export default function MessagesPage() {
  // The filters are read from the URL on the client, which needs a Suspense
  // boundary for the page shell to be prerendered.
  return (
    <Suspense fallback={<MessagesFallback />}>
      <MessagesView />
    </Suspense>
  );
}
