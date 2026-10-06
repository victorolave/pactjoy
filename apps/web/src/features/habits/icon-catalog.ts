import type { IconName } from "../../ui/icon/Icon.tsx";

/**
 * Persisted keys are a client catalog, independent of the glyph vendor. Domain status glyphs
 * (such as the pause one) stay out so a habit icon never reads as a season state.
 */
export const HABIT_ICONS: readonly { readonly key: string; readonly glyph: IconName }[] = [
  { key: "book", glyph: "book-open" },
  { key: "brain", glyph: "brain" },
  { key: "coffee", glyph: "coffee" },
  { key: "dumbbell", glyph: "dumbbell" },
  { key: "flower", glyph: "flower-2" },
  { key: "footprints", glyph: "footprints" },
  { key: "palette", glyph: "palette" },
  { key: "sun", glyph: "sun" },
  { key: "calendar", glyph: "calendar-days" },
  { key: "check", glyph: "check" },
  { key: "repeat", glyph: "repeat" },
  { key: "history", glyph: "history" },
  { key: "pencil", glyph: "pencil" },
  { key: "plus", glyph: "plus" },
  { key: "users", glyph: "users" },
  { key: "handshake", glyph: "handshake" },
  { key: "user", glyph: "user-round" },
  { key: "settings", glyph: "settings" },
  { key: "completed", glyph: "circle-check" },
  { key: "moon", glyph: "moon" },
];

export const CATEGORY_ICONS = {
  Leer: "book",
  Movimiento: "footprints",
  Estudiar: "brain",
  "Dormir mejor": "moon",
  Creatividad: "palette",
  Finanzas: "check",
  "Crear el mío": "flower",
} as const;

export const iconFor = (key: string | null): IconName =>
  HABIT_ICONS.find((icon) => icon.key === key)?.glyph ?? "flower-2";
