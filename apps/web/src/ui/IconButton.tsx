import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx.ts";
import styles from "./IconButton.module.css";
import { Icon, type IconName } from "./icon/Icon.tsx";

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children" | "aria-label"> {
  readonly icon: IconName;
  /** Required: an icon-only control has no other accessible name. */
  readonly label: string;
  readonly variant?: "ghost" | "outline" | "filled";
  /** `lg` is the 52 px stepper button of the entry sheets; the default is the 44 px touch target. */
  readonly size?: "md" | "lg";
  /** Makes it a toggle: reflected as `aria-pressed`. */
  readonly pressed?: boolean;
}

export function IconButton({
  icon,
  label,
  variant = "ghost",
  size = "md",
  pressed,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "pj-iconbtn",
        variant !== "ghost" && `pj-iconbtn--${variant}`,
        size === "lg" && styles.large,
      )}
      aria-label={label}
      title={label}
      {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
}
