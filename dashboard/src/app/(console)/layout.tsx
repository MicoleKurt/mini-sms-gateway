import type { ReactNode } from "react";
import { ConnectionIndicator } from "@/components/layout/connection-indicator";
import { Navigation } from "@/components/layout/navigation";
import { ProductMark } from "@/components/layout/product-mark";
import { ThemeToggle } from "@/components/layout/theme-toggle";

/** The console shell: a fixed sidebar from 768 px up, a top navigation below that. */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh md:pl-56">
      <a
        href="#main"
        className="sr-only rounded-md bg-primary px-3 py-2 text-on-primary focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col gap-6 border-r border-line bg-surface p-3 md:flex">
        <div className="px-1 pt-1">
          <ProductMark />
        </div>
        <Navigation orientation="vertical" />
      </aside>

      <header className="sticky top-0 z-20 border-b border-line bg-canvas/90 backdrop-blur">
        <div className="flex h-12 items-center justify-between gap-3 px-4 md:justify-end md:px-6">
          <div className="md:hidden">
            <ProductMark />
          </div>
          <div className="flex items-center gap-1">
            <ConnectionIndicator />
            <ThemeToggle />
          </div>
        </div>
        <div className="border-t border-line px-3 py-1.5 md:hidden">
          <Navigation orientation="horizontal" />
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-6">
        {children}
      </main>
    </div>
  );
}
