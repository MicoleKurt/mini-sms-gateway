import { RadioTower } from "lucide-react";
import Link from "next/link";

export function ProductMark() {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-md">
      <span className="flex size-8 items-center justify-center rounded-md bg-primary text-on-primary">
        <RadioTower aria-hidden className="size-4" />
      </span>
      <span className="leading-4">
        <span className="block font-semibold text-ink">SMS Gateway</span>
        <span className="block text-xs text-ink-muted">Internal console</span>
      </span>
    </Link>
  );
}
