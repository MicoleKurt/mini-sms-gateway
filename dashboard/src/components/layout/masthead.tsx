import Link from "next/link";
import { Navigation } from "./navigation";
import { StreamState } from "./stream-state";
import { ThemeSwitch } from "./theme-switch";

/**
 * The masthead on the page grid: the product name over the margin column,
 * the sections at the content edge, stream state and theme at the right.
 * Under 768 px the sections wrap onto a second line.
 */
export function Masthead() {
  return (
    <header className="mast">
      <Link href="/" className="mast-brand">
        SMS Gateway <span className="mono">ops</span>
      </Link>
      <Navigation />
      <div className="mast-end">
        <StreamState />
        <ThemeSwitch />
      </div>
    </header>
  );
}
