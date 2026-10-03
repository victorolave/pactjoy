import type { ReactNode } from "react";
import { pointsText } from "../../../shared/format.ts";
import { Card } from "../../../ui/Card.tsx";
import { cx } from "../../../ui/cx.ts";
import { Icon, type IconName } from "../../../ui/icon/Icon.tsx";
import styles from "./rows.module.css";

export interface RowFrameProps {
  readonly title: string;
  readonly glyph: IconName;
  readonly tone?: "default" | "done" | "muted";
  /** Lines of secondary text under the title. */
  readonly details?: readonly string[];
  /** Lines of success-coloured text (what was registered). */
  readonly statuses?: readonly string[];
  readonly badges?: ReactNode;
  /** Next to the title: "+8 pts" once the registro earned some. */
  readonly points?: number | null;
  /** Register control (or any trailing control). */
  readonly action?: ReactNode;
  /** Full-width content under the row (a progress bar). */
  readonly below?: ReactNode;
}

/** The card every Today row shares: glyph, title, text lines, optional control and bar. */
export function RowFrame({
  title,
  glyph,
  tone = "default",
  details = [],
  statuses = [],
  badges,
  points = null,
  action,
  below,
}: RowFrameProps) {
  return (
    <Card as="article" flush tone={tone === "muted" ? "sunken" : "default"}>
      <div className={styles.card}>
        <div className={styles.top}>
          <span
            data-tone={tone}
            className={cx(
              styles.glyph,
              tone === "done" && styles.glyphDone,
              tone === "muted" && styles.glyphMuted,
            )}
          >
            <Icon name={glyph} />
          </span>
          <div className={styles.body}>
            <div className={styles.titleLine}>
              <h3 className={styles.title}>{title}</h3>
              {points !== null && points > 0 && (
                <span className={styles.points}>{pointsText(points)}</span>
              )}
            </div>
            {statuses.map((text, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: lines are static text, never reordered
              <p key={index} className={styles.status}>
                {text}
              </p>
            ))}
            {details.map((text, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: lines are static text, never reordered
              <p key={index} className={styles.detail}>
                {text}
              </p>
            ))}
            {badges !== undefined && <div className={styles.badges}>{badges}</div>}
          </div>
          {action !== undefined && <div className={styles.action}>{action}</div>}
        </div>
        {below}
      </div>
    </Card>
  );
}
