"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";

const DEBOUNCE_MS = 300;
const INPUT_ID = "message-search";

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

interface SearchBoxProps {
  /** The committed search, from the URL. */
  value: string;
  onCommit: (value: string) => void;
  className?: string;
}

/**
 * The search field. Typing is local and instant; the value is committed (to
 * the URL, and so to the query) 300 ms after the last keystroke. "/" anywhere
 * on the page outside another field puts the cursor here.
 */
export function SearchBox({ value, onCommit, className }: SearchBoxProps) {
  const [draft, setDraft] = useState(value);
  const [seenValue, setSeenValue] = useState(value);
  const input = useRef<HTMLInputElement>(null);
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

  useEffect(() => {
    function focusOnSlash(event: KeyboardEvent) {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.defaultPrevented || isEditable(event.target)) return;
      event.preventDefault();
      input.current?.focus();
      input.current?.select();
    }
    document.addEventListener("keydown", focusOnSlash);
    return () => document.removeEventListener("keydown", focusOnSlash);
  }, []);

  return (
    <div className={cn("field", className)}>
      <label htmlFor={INPUT_ID} className="lbl">
        Search
      </label>
      <div className="relative">
        <input
          ref={input}
          id={INPUT_ID}
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="ID, number or client ref"
          aria-keyshortcuts="/"
          autoComplete="off"
          spellCheck={false}
          className={cn("input pr-12 [&::-webkit-search-cancel-button]:hidden", draft && "mono")}
        />
        <span className="absolute top-0 right-0 flex h-8 items-center">
          {draft !== "" ? (
            <Button variant="quiet" className="text-small" onClick={() => setDraft("")}>
              Clear<span className="sr-only"> search</span>
            </Button>
          ) : (
            <kbd aria-hidden className="mono text-label text-ink-3">
              /
            </kbd>
          )}
        </span>
      </div>
    </div>
  );
}
