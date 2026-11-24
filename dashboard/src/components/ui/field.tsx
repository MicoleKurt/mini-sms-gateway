import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  // "control" is the base look from globals.css. Utilities in className override it.
  return <input className={cn("control h-8", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea className={cn("control min-h-28 resize-y py-2 leading-5", className)} {...props} />
  );
}

/** A native select: it keeps the platform's keyboard and screen reader behaviour. `className` sizes the wrapper. */
export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={cn("relative inline-block", className)}>
      <select className="control h-8 appearance-none pr-8" {...props}>
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-ink-faint"
      />
    </span>
  );
}

interface FieldProps {
  /** The id of the control inside, so the label and the message line point at it. */
  htmlFor: string;
  label: string;
  optional?: boolean;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}

/** The id of a field's message line, for the control's aria-describedby. */
export function fieldMessageId(controlId: string) {
  return `${controlId}-message`;
}

/**
 * A label, a control and one message line under it. The line shows the hint,
 * or the error while there is one. It always takes its space, so an error
 * appearing does not move the fields below.
 *
 * Only the error is announced. A hint can hold a value that changes all the
 * time (a live balance), which a screen reader must not read out on every
 * change. The control points at the line with aria-describedby either way.
 */
export function Field({ htmlFor, label, optional, hint, error, children, className }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-ink">
        {label}
        {optional ? <span className="ml-1 font-normal text-ink-faint">optional</span> : null}
      </label>
      {children}
      {error ? (
        // The key makes this a new element, which is what gets an alert announced.
        <p
          key="error"
          id={fieldMessageId(htmlFor)}
          role="alert"
          className="min-h-4 text-xs text-danger-ink"
        >
          {error}
        </p>
      ) : (
        <p key="hint" id={fieldMessageId(htmlFor)} className="min-h-4 text-xs text-ink-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
