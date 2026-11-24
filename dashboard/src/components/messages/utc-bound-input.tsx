"use client";

import { useState } from "react";
import { formatUtcInput, parseUtcInput } from "./utc-input";

interface UtcBoundInputProps {
  id: string;
  /** Read by assistive technology: "Created from, UTC". */
  label: string;
  value: Date | null;
  placeholder: string;
  onCommit: (value: Date | null) => void;
}

/**
 * A From or To bound typed as UTC text. It commits on Enter or when it loses
 * focus; text that is not a time stays in the field with the format under it.
 */
export function UtcBoundInput({ id, label, value, placeholder, onCommit }: UtcBoundInputProps) {
  const committed = formatUtcInput(value);
  const [draft, setDraft] = useState(committed);
  const [seen, setSeen] = useState(committed);
  const [invalid, setInvalid] = useState(false);

  // A preset or Clear changed the bound: show it.
  if (committed !== seen) {
    setSeen(committed);
    setDraft(committed);
    setInvalid(false);
  }

  function commit() {
    const parsed = parseUtcInput(draft);
    if (parsed === "invalid") {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (formatUtcInput(parsed) !== committed) onCommit(parsed);
    else setDraft(committed);
  }

  const errorId = `${id}-error`;
  return (
    <span className="relative">
      <input
        id={id}
        aria-label={label}
        value={draft}
        placeholder={placeholder}
        title="YYYY-MM-DD HH:MM, in UTC"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
        className="input mono w-[17ch]"
      />
      {invalid ? (
        // Under the field and out of the flow, so the rows below do not move.
        <span
          id={errorId}
          role="alert"
          className="field-message is-error absolute top-full left-0 whitespace-nowrap"
        >
          Write it as YYYY-MM-DD HH:MM
        </span>
      ) : null}
    </span>
  );
}
