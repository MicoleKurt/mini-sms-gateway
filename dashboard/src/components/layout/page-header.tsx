import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  /** One line that says what the page is for. */
  description: string;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-1 text-ink-muted">{description}</p>
      </div>
      {actions}
    </header>
  );
}
