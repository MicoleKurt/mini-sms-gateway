"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/messages", label: "Messages" },
  { href: "/send", label: "Send test" },
];

function isCurrent(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** The three sections. The current one is ink with a 2 px rule under it. */
export function Navigation() {
  const pathname = usePathname();

  return (
    <nav aria-label="Sections" className="mast-sections">
      <ul className="mast-nav">
        {NAV_ITEMS.map(({ href, label }) => (
          <li key={href}>
            <Link href={href} aria-current={isCurrent(pathname, href) ? "page" : undefined}>
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
