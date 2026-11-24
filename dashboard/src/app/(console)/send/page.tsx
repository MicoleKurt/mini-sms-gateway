import type { Metadata } from "next";
import { SendView } from "@/components/send/send-view";

export const metadata: Metadata = { title: "Send test" };

export default function SendPage() {
  return <SendView />;
}
