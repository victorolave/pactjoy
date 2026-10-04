import type { ReactNode } from "react";
import { Link } from "react-router";
import type { ButtonVariant } from "./Button.tsx";
import { cx } from "./cx.ts";

export interface ButtonLinkProps {
  readonly to: string;
  readonly variant?: ButtonVariant;
  readonly size?: "md" | "sm";
  readonly block?: boolean;
  readonly children: ReactNode;
}

/** A navigation that looks like a Button: a real link, so it keeps link semantics and middle-click. */
export function ButtonLink({
  to,
  variant = "primary",
  size = "md",
  block = false,
  children,
}: ButtonLinkProps) {
  return (
    <Link
      to={to}
      className={cx(
        "pj-btn",
        `pj-btn--${variant}`,
        size === "sm" && "pj-btn--sm",
        block && "pj-btn--block",
      )}
    >
      {children}
    </Link>
  );
}
