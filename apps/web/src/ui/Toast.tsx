import { useEffect, useRef, useState } from "react";
import { Button } from "./Button.tsx";

/** How long a plain toast stays up (the design's prototype uses 4 s). */
const DEFAULT_DURATION_MS = 4000;
/** A toast with Deshacer or Reintentar needs time to be reached and read. */
const ACTION_DURATION_MS = 8000;

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
  durationMs = actionLabel === undefined ? DEFAULT_DURATION_MS : ACTION_DURATION_MS,
}: ToastProps) {
  // The latest callback is read when the timer fires, so a new function identity on re-render
  // does not restart the countdown.
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  // Hovering or focusing the toast pauses the countdown; leaving it counts a full time again.
  const [held, setHeld] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new message restarts the countdown
  useEffect(() => {
    if (durationMs === null || held) return;
    const timer = setTimeout(() => dismiss.current?.(), durationMs);
    return () => clearTimeout(timer);
  }, [durationMs, held, message]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover and focus only pause the timer
    <div
      className="pj-toast"
      role={tone === "error" ? "alert" : "status"}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <span className="pj-toast__msg">{message}</span>
      {actionLabel !== undefined && (
        <Button variant="ghost" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
