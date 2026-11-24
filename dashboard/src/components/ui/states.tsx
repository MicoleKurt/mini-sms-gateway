import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { describeError } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";
import { Button } from "./button";
import { LoadingLabel, SkeletonText } from "./skeleton";
import { StatusMark } from "./status";

/**
 * The loading state of a data region: lines shaped like the text that will
 * come, with no numbers, and a status for assistive technology.
 */
export function LoadingState({
  label,
  lines = 2,
  widths,
  className,
}: {
  /** What is loading, read by screen readers ("Loading tenants"). */
  label: string;
  lines?: number;
  widths?: readonly string[];
  className?: string;
}) {
  return (
    <div aria-busy className={className}>
      <SkeletonText lines={lines} widths={widths} />
      <LoadingLabel>{label}</LoadingLabel>
    </div>
  );
}

interface EmptyStateProps {
  /** What there is none of, as a sentence ("No messages match these filters."). */
  title: string;
  /** The next step, in words ("Widen the time range or clear the search."). */
  description?: string;
  /** A button or link that takes the next step. */
  action?: ReactNode;
  className?: string;
}

/** The empty state of a data region: one line that says so, and the next step. */
export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("state", className)}>
      <p className="state-title">{title}</p>
      {description ? <p className="state-text">{description}</p> : null}
      {action}
    </div>
  );
}

interface ErrorStateProps {
  /** What could not be loaded, for example "Tenants could not be loaded". */
  title: string;
  error: unknown;
  onRetry: () => void;
  className?: string;
}

/** The error state of a data region: what failed, why, and Retry. */
export function ErrorState({ title, error, onRetry, className }: ErrorStateProps) {
  return (
    <div role="alert" className={cn("state", className)}>
      <p className="state-title">
        <StatusMark status="FAILED" className="mr-2" />
        {title}.
      </p>
      <p className="state-text whitespace-pre-line">{describeError(error)}</p>
      <Button variant="quiet" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

type AlertTone = "danger" | "warn";

const ALERT_TONES: Record<AlertTone, string> = {
  danger: "notice-danger",
  warn: "notice-warn",
};

interface AlertProps {
  tone: AlertTone;
  title: string;
  children?: ReactNode;
  className?: string;
}

/**
 * An inline notice: a rule in the tone's ink above a title and a line of
 * text. No tinted box. The caller decides whether it is announced.
 */
export function Alert({ tone, title, children, className }: AlertProps) {
  return (
    <div className={cn("notice", ALERT_TONES[tone], className)}>
      <p className="notice-title">{title}</p>
      {children ? <div className="notice-text">{children}</div> : null}
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
      <Alert tone="warn" title={title}>
        Showing data from <span className="num">{formatDateTime(query.dataUpdatedAt)}</span>.{" "}
        {describeError(query.error)}{" "}
        <Button variant="quiet" onClick={() => query.refetch()}>
          Retry
        </Button>
      </Alert>
    </div>
  );
}
