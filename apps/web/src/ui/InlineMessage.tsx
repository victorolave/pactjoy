import type { ReactNode } from "react";
import { cx } from "./cx.ts";
import { Icon, type IconName } from "./icon/Icon.tsx";

export type MessageTone = "info" | "success" | "error" | "pending";

const ICONS: Record<MessageTone, IconName> = {
  info: "info",
  success: "circle-check",
  error: "circle-alert",
  pending: "cloud-off",
};

export interface InlineMessageProps {
  readonly tone?: MessageTone;
  readonly title?: string;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
}

/** An error is announced assertively (`alert`); everything else politely (`status`). */
export function InlineMessage({ tone = "info", title, children, action }: InlineMessageProps) {
  return (
    <div className={cx("pj-msg", `pj-msg--${tone}`)} role={tone === "error" ? "alert" : "status"}>
      <span className="pj-msg__icon">
        <Icon name={ICONS[tone]} />
      </span>
      <div className="pj-msg__body">
        {title !== undefined && <span className="pj-msg__title">{title}</span>}
        {children !== undefined && <span className="pj-msg__text">{children}</span>}
      </div>
      {action !== undefined && <div className="pj-msg__action">{action}</div>}
    </div>
  );
}
