import type { ReactNode } from "react";
import { RefreshCw, TriangleExclamationPoint } from "lucide-react";
import { cn } from "@/lib/cn";
import { describeError } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";
import { Button } from "./button";

interface ErrorStateProps {
  /** What could not be loaded, for example "Tenants could not be loaded". */
  title: string;
  error: unknown;
  onRetry: () => void;
  /** One row instead of a centred stack, for a region that is wide and low. */
  inline?: boolean;
  className?: string;
}

/** The error state of a data region: what failed, why, and a way to try again. */
export function ErrorState({ title, error, onRetry, inline = false, className }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-center gap-3 px-4",
        inline ? "py-3" : "flex-col justify-center py-8 text-center",
        className,
      )}
    >
      <TriangleExclamationPoint aria-hidden className="size-5 shrink-0 text-danger" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink">{title}</p>
        <p className="mt-1 max-w-prose text-xs break-words whitespace-pre-line text-ink-muted">
          {describeError(error)}
        </p>
      </div>
      <Button size="sm" onClick={onRetry}>
        <RefreshCw aria-hidden />
        Retry
      </Button>
    </div>
  );
}

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-4 py-8 text-center",
        className,
      )}
    >
      {icon ? <span className="text-ink-faint [&_svg]:size-5">{icon}</span> : null}
      <div>
        <p className="font-medium text-ink">{title}</p>
        {description ? (
          <p className="mt-1 max-w-prose text-xs text-ink-muted">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

type AlertTone = "danger" | "warn" | "ok";

const ALERT_TONES: Record<AlertTone, string> = {
  danger: "border-danger/40 bg-danger-tint text-danger-ink",
  warn: "border-warn/40 bg-warn-tint text-warn-ink",
  ok: "border-ok/40 bg-ok-tint text-ok-ink",
};

interface AlertProps {
  tone: AlertTone;
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  className?: string;
}

/** An inline notice. The caller decides whether it is announced (role, aria-live). */
export function Alert({ tone, icon, title, children, className }: AlertProps) {
  return (
    <div className={cn("flex gap-2.5 rounded-md border px-3 py-2.5", ALERT_TONES[tone], className)}>
      {icon ? <span className="mt-0.5 [&_svg]:size-4">{icon}</span> : null}
      <div className="min-w-0 text-sm">
        <p className="font-medium">{title}</p>
        {children ? <div className="mt-0.5 text-xs">{children}</div> : null}
      </div>
    </div>
  );
}

interface RefreshFailedNoticeProps {
  /** What is out of date, for example "Tenants could not be refreshed". */
  title: string;
  /** The query result. Only these four fields of it are read. */
  query: { isRefetchError: boolean; dataUpdatedAt: number; error: unknown; refetch: () => unknown };
  className?: string;
}

/**
 * For a region that keeps showing its last data after a refresh failed. It
 * says that the data is old, from when it is, why, and offers a retry.
 * Renders nothing unless the query is in that state.
 */
export function RefreshFailedNotice({ title, query, className }: RefreshFailedNoticeProps) {
  if (!query.isRefetchError) return null;
  return (
    <div role="alert" className={className}>
      <Alert tone="warn" icon={<TriangleExclamationPoint aria-hidden />} title={title}>
        Showing data from <span className="font-mono">{formatDateTime(query.dataUpdatedAt)}</span>.{" "}
        {describeError(query.error)}{" "}
        <button
          type="button"
          onClick={() => query.refetch()}
          className="font-medium underline underline-offset-2"
        >
          Retry
        </button>
      </Alert>
    </div>
  );
}
