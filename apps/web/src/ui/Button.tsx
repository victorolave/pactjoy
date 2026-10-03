import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx.ts";
import { Icon, type IconName } from "./icon/Icon.tsx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "inverse";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  readonly variant?: ButtonVariant;
  readonly size?: "md" | "sm";
  /** Full width. */
  readonly block?: boolean;
  readonly leadingIcon?: IconName;
}

export function Button({
  variant = "primary",
  size = "md",
  block = false,
  leadingIcon,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "pj-btn",
        `pj-btn--${variant}`,
        size === "sm" && "pj-btn--sm",
        block && "pj-btn--block",
      )}
      {...rest}
    >
      {leadingIcon !== undefined && <Icon name={leadingIcon} size="sm" />}
      {children}
    </button>
  );
}
