"use client";

import { useRef, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { Textarea } from "@/components/ui/field";
import { forcesUcs2 } from "./ucs2-cause";
import styles from "./send.module.css";

/** The text with each character that forces UCS-2 in a box, laid out like the field. */
function boxed(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let run = "";
  for (const char of text) {
    if (!forcesUcs2(char)) {
      run += char;
      continue;
    }
    if (run) parts.push(run);
    run = "";
    parts.push(
      <mark key={parts.length} className={styles.causeBox}>
        {char}
      </mark>,
    );
  }
  // A final line break only takes up a line in the layer when something follows it.
  parts.push(`${run} `);
  return parts;
}

type MarkedTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string };

/**
 * The message text field, with each character that forces UCS-2 boxed in
 * the attention ink where it stands. The boxes are drawn on a layer behind
 * the field that has its font, padding and wrapping and follows its scroll;
 * the field itself has no background, so its text and caret are untouched.
 */
export function MarkedTextarea({ value, className, onScroll, ...props }: MarkedTextareaProps) {
  const layer = useRef<HTMLDivElement>(null);
  return (
    <div className={styles.marked}>
      <div ref={layer} aria-hidden className={cn("input textarea", styles.markLayer)}>
        {boxed(value)}
      </div>
      <Textarea
        value={value}
        className={cn(styles.markedInput, className)}
        onScroll={(event) => {
          if (layer.current) layer.current.scrollTop = event.currentTarget.scrollTop;
          onScroll?.(event);
        }}
        {...props}
      />
    </div>
  );
}
