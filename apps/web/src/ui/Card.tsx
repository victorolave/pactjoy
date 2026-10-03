import type { HTMLAttributes } from "react";
import styles from "./Card.module.css";
import { cx } from "./cx.ts";

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "className"> {
  readonly as?: "div" | "section" | "article" | "li";
  readonly tone?: "default" | "sunken" | "warm" | "inverse" | "success";
  /** The larger radius used for hero blocks. */
  readonly panel?: boolean;
  /** No padding of its own: the content sets it (rows, the season card). */
  readonly flush?: boolean;
}

export function Card({
  as: Element = "div",
  tone = "default",
  panel = false,
  flush = false,
  ...rest
}: CardProps) {
  return (
    <Element
      className={cx(
        "pj-card",
        tone === "success" ? styles.success : tone !== "default" && `pj-card--${tone}`,
        panel && "pj-card--panel",
        flush && "pj-card--flush",
      )}
      {...rest}
    />
  );
}
