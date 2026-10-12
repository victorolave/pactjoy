/**
 * The SRBAI wording in one module (REQ-A10, design 13, 35a and 35c). The Spanish translation is
 * NOT validated yet (Notion note, ADR-0014): change it here and nowhere else. The wire carries
 * only the habit's name, which can be a noun or an infinitive, so every phrase quotes it in
 * guillemets and continues with a neutral "lo" (owner decision, periodic-review verify W5).
 */

/** Items per commitment in a full SRBAI. */
export const SRBAI_ITEMS = 4;

export type SrbaiItem = 0 | 1 | 2 | 3;

const PHRASES: readonly ((habit: string) => string)[] = [
  (habit) => `«${habit}»: lo hago automáticamente.`,
  (habit) => `«${habit}»: lo hago sin tener que recordarlo conscientemente.`,
  (habit) => `«${habit}»: lo hago sin pensar.`,
  (habit) => `«${habit}»: empiezo a hacerlo antes de darme cuenta.`,
];

export function srbaiPhrase(habit: string, item: SrbaiItem): string {
  return (PHRASES[item] as (habit: string) => string)(habit);
}

/** The 1 to 7 scale and the labels of its two ends (35a, 13). */
export const SRBAI_SCALE = {
  min: 1,
  max: 7,
  low: "1 · Nada de acuerdo",
  high: "7 · Totalmente",
} as const;

/** The single line under the heading of the item-1 screen (35c). */
export const ITEM_ONE_SCALE_HINT = "1 · nada de acuerdo — 7 · totalmente";

export const PRIVATE_NOTE = "Solo tú verás estas respuestas.";
