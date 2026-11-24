"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "./button";

const CONFIRMATION_MS = 1_500;

/**
 * A quiet text button that copies `value` to the clipboard. `label` is the
 * visible text ("Copy ID"); it reads "Copied" for a moment afterwards.
 */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      toast.error("Could not copy to the clipboard.");
    }
  }

  return (
    <Button variant="quiet" onClick={copy} className="text-small">
      {copied ? "Copied" : label}
      <span role="status" className="sr-only">
        {copied ? "Copied" : ""}
      </span>
    </Button>
  );
}
