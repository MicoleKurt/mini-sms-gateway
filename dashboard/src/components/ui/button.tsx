import type { ComponentProps, MouseEvent } from "react";
import { cn } from "@/lib/cn";

/**
 * primary: solid ink, one per screen (Send). secondary: an ink outline.
 * quiet: an underlined word (Clear, Reset, Retry).
 */
type Variant = "primary" | "secondary" | "quiet";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  quiet: "btn-quiet",
};

const SIZES: Record<Size, string | undefined> = {
  sm: "btn-sm",
  md: undefined,
};

interface ButtonStyle {
  variant?: Variant;
  size?: Size;
  className?: string;
}

/** The button look as a class string, for links that should look like buttons. */
export function buttonClasses({ variant = "secondary", size = "md", className }: ButtonStyle = {}) {
  return cn("btn", VARIANTS[variant], variant !== "quiet" && SIZES[size], className);
}

type ButtonProps = ComponentProps<"button"> & ButtonStyle;

function ignoreActivation(event: MouseEvent) {
  // Also stops a submit button from submitting its form.
  event.preventDefault();
}

/**
 * `disabled` is for a button that can not be used at all. For a state that
 * comes and goes while the button may have focus (a request in flight), pass
 * `aria-disabled` instead: a disabled button drops keyboard focus to <body>,
 * an aria-disabled one keeps it, looks the same and ignores activation.
 */
export function Button({
  variant,
  size,
  className,
  type = "button",
  onClick,
  ...props
}: ButtonProps) {
  const inactive = props["aria-disabled"] === true || props["aria-disabled"] === "true";
  return (
    <button
      type={type}
      className={buttonClasses({ variant, size, className })}
      onClick={inactive ? ignoreActivation : onClick}
      {...props}
    />
  );
}
