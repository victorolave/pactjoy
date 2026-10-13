/** Pure formatting for the season close screens (36 to 38b). Spanish, decimal comma. */

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "85 %" (a space before the sign, as in the design), or a dash when nothing was counted. */
export const percentText = (percent: number | null): string =>
  percent === null ? "–" : `${percent} %`;

/** "2026-08-25" -> "25 ago". */
export function shortDate(isoDate: string): string {
  const match = ISO_DATE.exec(isoDate);
  if (match === null) return isoDate;
  const month = MONTHS[Number(match[2]) - 1];
  return month === undefined ? isoDate : `${Number(match[3])} ${month}`;
}

interface Journey {
  readonly from: string | null;
  readonly to: string | null;
}

/** "3,5" -> 3.5. The API sends the engine's display text, with the decimal comma. */
const score = (text: string | null): number | null => {
  if (text === null) return null;
  const value = Number(text.replace(",", "."));
  return Number.isFinite(value) ? value : null;
};

/** "3,5 → 5,8", only the end when there was no start, `null` without the closing score. */
export function automaticityLabel({ from, to }: Journey): string | null {
  if (to === null) return null;
  return from === null ? to : `${from} → ${to}`;
}

const SCALE_MIN = 1;
const SCALE_SPAN = 6;
/** A start that equals the end, or no start at all, is drawn as a small mark (percent of the track). */
const MARK_WIDTH = 2;

const positionOf = (value: number): number =>
  (Math.min(Math.max(value, SCALE_MIN), SCALE_MIN + SCALE_SPAN) - SCALE_MIN) / SCALE_SPAN;

/**
 * The bar of the automaticity card: the span from the start to the end on the 1 to 7 scale, as
 * percentages of the track. `null` without a closing score.
 */
export function automaticityBar(journey: Journey): { left: number; width: number } | null {
  const end = score(journey.to);
  if (end === null) return null;
  const start = score(journey.from);
  if (start === null || start === end) {
    return { left: positionOf(end) * 100 - MARK_WIDTH / 2, width: MARK_WIDTH };
  }
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  return { left: positionOf(low) * 100, width: (positionOf(high) - positionOf(low)) * 100 };
}

/** A gap of at most this many points (2 % of the 1,000 a member can earn) is "muy pareja". */
export const CLOSE_SEASON_MAX_GAP = 20;

/**
 * The line under the final standings (36): the gap between first and second, and "muy pareja" when
 * that gap is small. Points are the circle's, peer-visible figures.
 */
export function finalStandingsFootnote(points: readonly number[]): string {
  const [first = 0, second = 0] = [...points].sort((a, b) => b - a);
  if (first === 0) return "Nadie sumó puntos esta temporada";
  const gap = first - second;
  if (gap === 0) return "Mismos puntos. Fue una temporada muy pareja.";
  const difference = `${gap} ${gap === 1 ? "pt" : "pts"} de diferencia.`;
  return gap <= CLOSE_SEASON_MAX_GAP ? `${difference} Fue una temporada muy pareja.` : difference;
}

/** "Consistencia 88 % · automaticidad 5,8" (37), keeping only what is known. */
export function stageLine(row: {
  readonly consistencyPercent: number | null;
  readonly automaticity: Journey;
}): string {
  const parts = [
    ...(row.consistencyPercent === null ? [] : [`Consistencia ${row.consistencyPercent} %`]),
    ...(row.automaticity.to === null ? [] : [`automaticidad ${row.automaticity.to}`]),
  ];
  const text = parts.join(" · ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** The lead of 38b. The design counts opportunities; the results carry the consistency instead. */
export function graduationLead(weeks: number, consistencyPercent: number | null): string {
  const counted =
    consistencyPercent === null
      ? `${weeks} semanas`
      : `${weeks} semanas, ${consistencyPercent} % de consistencia`;
  return `${counted} y ya no necesitas llevar la cuenta. Ahora es parte de tu rutina.`;
}
