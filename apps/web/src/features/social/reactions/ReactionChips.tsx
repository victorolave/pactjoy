import { useOnline } from "../../../context/connectivity-context.tsx";
import type { ReactionCode, ReactionsDto } from "../../../ports/wire.ts";
import { cx } from "../../../ui/cx.ts";
import { REACTIONS } from "./reaction-emojis.ts";
import styles from "./reactions.module.css";

export interface ReactionChipsProps {
  readonly reactions: ReactionsDto;
  /** The viewer's reaction afterwards: the tapped code, or `null` when they tapped their own. */
  readonly onReact: (code: ReactionCode | null) => void;
}

const nameOf = (label: string, count: number): string => (count > 0 ? `${label}, ${count}` : label);

/**
 * The four reactions of one feed item (❤️ 🙌 🔥 👏): filled when it is the viewer's, with a count
 * when above zero. Who reacted is never shown. An item the viewer cannot react to (their own, a
 * member who left) shows no buttons, only the counts that exist, read-only. Offline the buttons
 * are disabled and say why: a reaction is a write and nothing is queued (P1).
 */
export function ReactionChips({ reactions, onReact }: ReactionChipsProps) {
  const online = useOnline();
  if (!reactions.reactable) {
    const present = REACTIONS.filter(({ code }) => reactions.counts[code] > 0);
    if (present.length === 0) return null;
    return (
      <ul className={styles.chips} aria-label="Reacciones">
        {present.map(({ code, glyph, label }) => (
          <li
            key={code}
            className={styles.readOnly}
            aria-label={nameOf(label, reactions.counts[code])}
          >
            <span aria-hidden="true">{glyph}</span>
            <span aria-hidden="true" className={styles.count}>
              {reactions.counts[code]}
            </span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <>
      <div className={styles.chips}>
        {REACTIONS.map(({ code, glyph, label }) => {
          const count = reactions.counts[code];
          const mine = reactions.mine === code;
          return (
            <button
              key={code}
              type="button"
              className={cx("pj-tag", styles.chip)}
              aria-pressed={mine}
              aria-label={nameOf(label, count)}
              disabled={!online}
              onClick={() => onReact(mine ? null : code)}
            >
              <span aria-hidden="true">{glyph}</span>
              {count > 0 && (
                <span aria-hidden="true" className={styles.count}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {!online && (
        <p className={styles.offline}>Sin conexión: vuelve a conectarte para reaccionar.</p>
      )}
    </>
  );
}
