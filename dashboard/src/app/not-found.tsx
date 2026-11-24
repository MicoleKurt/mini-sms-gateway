import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="font-mono text-xs text-ink-faint">404</p>
      <h1 className="text-xl font-semibold tracking-tight text-ink">Page not found</h1>
      <p className="text-ink-muted">There is nothing at this address.</p>
      <Link href="/" className={buttonClasses({ className: "mt-2" })}>
        Go to the overview
      </Link>
    </main>
  );
}
