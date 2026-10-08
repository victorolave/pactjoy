import type { ReactNode } from "react";
import { cx } from "./cx.ts";
import { Icon, type IconName } from "./icon/Icon.tsx";

export type BadgeTone = "neutral" | "success" | "pending" | "error" | "info" | "inverse";

export interface BadgeProps {
  readonly tone?: BadgeTone;
  readonly icon?: IconName;
  readonly children: ReactNode;
}

export function Badge({ tone = "neutral", icon, children }: BadgeProps) {
  return (
    <span className={cx("pj-badge", `pj-badge--${tone}`)}>
      {icon !== undefined && <Icon name={icon} size={14} strokeWidth={2.2} />}
      {children}
    </span>
  );
}
