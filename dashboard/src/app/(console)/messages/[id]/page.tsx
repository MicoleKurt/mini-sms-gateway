import type { Metadata } from "next";
import { MessageDetailView } from "@/components/message-detail/message-detail-view";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  // The first two groups of the ID tell messages apart in a list of tabs.
  return { title: `Message ${id.split("-").slice(0, 2).join("-")}` };
}

export default async function MessageDetailPage({ params }: PageProps) {
  const { id } = await params;
  return <MessageDetailView id={id} />;
}
