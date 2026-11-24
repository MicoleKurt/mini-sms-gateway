import type { ReactNode } from "react";
import { Masthead } from "@/components/layout/masthead";

/** The console shell: the masthead, then the page on paper. No sidebar. */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Masthead />
      <main id="main" className="page">
        {children}
      </main>
    </>
  );
}
