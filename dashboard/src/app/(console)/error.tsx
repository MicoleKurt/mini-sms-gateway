"use client";

import { Section } from "@/components/ui/section";
import { ErrorState } from "@/components/ui/states";

/** Catches a rendering error in a page, so the masthead and navigation stay usable. */
export default function ConsoleError({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <Section ruled={false}>
      <ErrorState title="This page failed to render" error={error} onRetry={retry} />
    </Section>
  );
}
