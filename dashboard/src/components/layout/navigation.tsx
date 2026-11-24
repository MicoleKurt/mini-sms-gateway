"use client";

import { LayoutDashboard, MessagesSquare, SendHorizontal, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/messages", label: "Messages", icon: MessagesSquare },
  { href: "/send", label: "Send test", icon: SendHorizontal },
];

// The background of the current item is close to the page colour, so a bar
// in the ink colour marks it as well: at the side in the sidebar, underneath
// in the top bar.
const CURRENT_MARK = {
  vertical: "shadow-[inset_2px_0_0_var(--ink)]",
  horizontal: "shadow-[inset_0_-2px_0_var(--ink)]",
};

function isCurrent(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** The main navigation. Vertical in the sidebar, horizontal in the top bar on small screens. */
export function Navigation({ orientation }: { orientation: "vertical" | "horizontal" }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main">
      <ul
        className={cn(
          "flex gap-1",
          // The scroll container would clip the focus ring of its links. The
          // padding makes room for it and the margin takes the space back.
          orientation === "vertical" ? "flex-col" : "-m-1 overflow-x-auto p-1",
        )}
      >
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const current = isCurrent(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex h-8 items-center gap-2 rounded-md px-2.5 font-medium whitespace-nowrap transition-colors",
                  current
                    ? cn("bg-raised text-ink", CURRENT_MARK[orientation])
                    : "text-ink-muted hover:bg-raised hover:text-ink",
                )}
              >
                <Icon aria-hidden className="size-4" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
