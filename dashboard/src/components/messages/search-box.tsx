"use client";

import { Search, X } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";
import { Input } from "@/components/ui/field";

const DEBOUNCE_MS = 300;

interface SearchBoxProps {
  /** The committed search, from the URL. */
  value: string;
  onCommit: (value: string) => void;
}

/**
 * The search field. Typing is local and instant. The value is committed (to
 * the URL, and so to the query) 300 ms after the last keystroke.
 */
export function SearchBox({ value, onCommit }: SearchBoxProps) {
  const [draft, setDraft] = useState(value);
  const [seenValue, setSeenValue] = useState(value);
  // Read at commit time, so a parent that re-renders often does not restart the timer.
  const commit = useEffectEvent(onCommit);

  // The URL changed. Unless that was this field's own commit, show the new value.
  if (value !== seenValue) {
    setSeenValue(value);
    if (value !== draft.trim()) setDraft(value);
  }

  useEffect(() => {
    const next = draft.trim();
    if (next === value) return;
    const timer = setTimeout(() => commit(next), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, value]);

  return (
    <div className="relative w-full sm:w-72">
      <label htmlFor="message-search" className="sr-only">
        Search by message ID, destination number or client reference
      </label>
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-faint"
      />
      <Input
        id="message-search"
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Message ID, number or client_ref"
        autoComplete="off"
        spellCheck={false}
        className="px-8 font-mono text-xs [&::-webkit-search-cancel-button]:hidden"
      />
      {draft !== "" ? (
        <button
          type="button"
          onClick={() => setDraft("")}
          aria-label="Clear search"
          className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded text-ink-faint hover:text-ink"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
