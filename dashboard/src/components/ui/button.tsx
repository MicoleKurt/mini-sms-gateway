import type { ComponentProps, MouseEvent } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost";
/** "icon" is a square button for a single icon. Give it an aria-label. */
type Size = "sm" | "md" | "icon";

const BASE =
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap " +
  "transition-colors disabled:pointer-events-none disabled:opacity-50 " +
  "aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary/85",
  secondary: "border border-control-border bg-surface text-ink hover:bg-raised",
  ghost: "text-ink-muted hover:bg-raised hover:text-ink",
};

const SIZES: Record<Size, string> = {
  sm: "h-7 px-2 text-xs",
  md: "h-8 px-3 text-sm",
  icon: "size-7",
};

interface ButtonStyle {
  variant?: Variant;
  size?: Size;
  className?: string;
}

/** The button look as a class string, for links that should look like buttons. */
export function buttonClasses({ variant = "secondary", size = "md", className }: ButtonStyle = {}) {
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
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
