"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "./button";

const CONFIRMATION_MS = 1_500;

/** Copies `value` to the clipboard and confirms it in place for a moment. */
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
    <Button variant="ghost" size="icon" onClick={copy} aria-label={label}>
      {copied ? <Check aria-hidden className="text-ok" /> : <Copy aria-hidden />}
      <span role="status" className="sr-only">
        {copied ? "Copied" : ""}
      </span>
    </Button>
  );
}
