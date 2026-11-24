"use client";

import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";

/** Catches a rendering error in a page, so the shell and navigation stay usable. */
export default function ConsoleError({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <Card>
      <ErrorState
        className="min-h-72"
        title="This page failed to render"
        error={error}
        onRetry={retry}
      />
    </Card>
  );
}
