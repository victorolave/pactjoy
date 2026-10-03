import type { ReactNode } from "react";
import { cx } from "./cx.ts";

export interface TagProps {
  /** Present (true or false) makes the tag a toggle, reported through `aria-pressed`. */
  readonly selected?: boolean;
  readonly onClick?: () => void;
  readonly children: ReactNode;
}

export function Tag({ selected, onClick, children }: TagProps) {
  const interactive = selected !== undefined || onClick !== undefined;
  if (!interactive) return <span className={cx("pj-tag", "pj-tag--static")}>{children}</span>;
  return (
    <button
      type="button"
      className="pj-tag"
      onClick={onClick}
      {...(selected === undefined ? {} : { "aria-pressed": selected })}
    >
      {children}
    </button>
  );
}
