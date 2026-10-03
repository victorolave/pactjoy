import { useEffect, useRef } from "react";
import { Button } from "./Button.tsx";

/** How long an undo toast stays up (the design's prototype uses 4 s). */
const DEFAULT_DURATION_MS = 4000;

export interface ToastProps {
  readonly message: string;
  readonly tone?: "default" | "error";
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  /** Called when the time is up. The owner of the toast removes it. */
  readonly onDismiss?: () => void;
  /** `null` keeps the toast until the user acts (use for errors that offer a retry). */
  readonly durationMs?: number | null;
}

export function Toast({
  message,
  tone = "default",
  actionLabel,
  onAction,
  onDismiss,
  durationMs = DEFAULT_DURATION_MS,
}: ToastProps) {
  // The latest callback is read when the timer fires, so a new function identity on re-render
  // does not restart the countdown.
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    if (durationMs === null) return;
    const timer = setTimeout(() => dismiss.current?.(), durationMs);
    return () => clearTimeout(timer);
  }, [durationMs]);

  return (
    <div className="pj-toast" role={tone === "error" ? "alert" : "status"} aria-live="polite">
      <span className="pj-toast__msg">{message}</span>
      {actionLabel !== undefined && (
        <Button variant="ghost" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
