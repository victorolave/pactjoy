import { type ReactNode, useEffect, useId, useRef } from "react";
import { cx } from "./cx.ts";
import { IconButton } from "./IconButton.tsx";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface SheetProps {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly placement?: "bottom" | "center";
  readonly children?: ReactNode;
  /** Buttons stacked under the content. */
  readonly actions?: ReactNode;
}

export function Sheet({ open, ...rest }: SheetProps) {
  return open ? <OpenSheet {...rest} /> : null;
}

function OpenSheet({
  title,
  onClose,
  placement = "bottom",
  children,
  actions,
}: Omit<SheetProps, "open">) {
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Focus moves in on open and goes back to whatever had it when the sheet closes.
  useEffect(() => {
    const opener = document.activeElement;
    dialog.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  // Document level, so Escape and Tab keep working after a click leaves focus on content that
  // cannot take it (a paragraph, the scrim): a keydown there never reaches the dialog.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const box = dialog.current;
      if (box === null) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) return;
      const active = document.activeElement;
      if (!(active instanceof Node) || !box.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    // The scrim is a pointer shortcut only; keyboard users close with Escape or the Cerrar button.
    // biome-ignore lint/a11y/noStaticElementInteractions: see above
    // biome-ignore lint/a11y/useKeyWithClickEvents: see above
    <div
      className={cx("pj-scrim", "pj-scrim--fixed", `pj-scrim--${placement}`)}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        className={cx("pj-sheet", `pj-sheet--${placement}`)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {placement === "bottom" && <span className="pj-sheet__grab" />}
        <div className="pj-sheet__head">
          <h2 id={titleId} className="pj-sheet__title">
            {title}
          </h2>
          <IconButton icon="x" label="Cerrar" onClick={onClose} />
        </div>
        {children}
        {actions !== undefined && <div className="pj-sheet__actions">{actions}</div>}
      </div>
    </div>
  );
}
