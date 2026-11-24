import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";

/** An underline field. Add className="mono" for numbers, IDs and sender names. */
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("input", className)} {...props} />;
}

/** The one filled control: message text, on --paper-sunk with an underline. */
export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("input textarea", className)} {...props} />;
}

/** A native select: it keeps the platform's keyboard and screen reader behaviour. `className` sizes the wrapper. */
export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={cn("select", className)}>
      <select className="input" {...props}>
        {children}
      </select>
      <svg aria-hidden viewBox="0 0 10 10" className="select-chevron">
        <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
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
 * A caps label, a control and one message line under it. The line shows the
 * hint, or the error while there is one. It always takes its space, so an
 * error appearing does not move the fields below.
 *
 * Only the error is announced. A hint can hold a value that changes all the
 * time (a live balance), which a screen reader must not read out on every
 * change. The control points at the line with aria-describedby either way.
 */
export function Field({ htmlFor, label, optional, hint, error, children, className }: FieldProps) {
  return (
    <div className={cn("field", className)}>
      <label htmlFor={htmlFor} className="lbl field-label">
        {label}
        {optional ? <span className="field-optional">optional</span> : null}
      </label>
      {children}
      {error ? (
        // The key makes this a new element, which is what gets an alert announced.
        <p key="error" id={fieldMessageId(htmlFor)} role="alert" className="field-message is-error">
          {error}
        </p>
      ) : (
        <p key="hint" id={fieldMessageId(htmlFor)} className="field-message">
          {hint}
        </p>
      )}
    </div>
  );
}
