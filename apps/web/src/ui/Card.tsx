import type { HTMLAttributes } from "react";
import { cx } from "./cx.ts";

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "className"> {
  readonly as?: "div" | "section" | "article" | "li";
  readonly tone?: "default" | "sunken" | "warm" | "inverse";
  /** The larger radius used for hero blocks. */
  readonly panel?: boolean;
}

export function Card({ as: Element = "div", tone = "default", panel = false, ...rest }: CardProps) {
  return (
    <Element
      className={cx("pj-card", tone !== "default" && `pj-card--${tone}`, panel && "pj-card--panel")}
      {...rest}
    />
  );
}
