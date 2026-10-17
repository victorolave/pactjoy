import type { ReactionCode } from "../../../ports/wire.ts";

/**
 * The four reactions in the order the design shows them (❤️ 🙌 🔥 👏). The API speaks codes; the
 * glyph and its Spanish name live only here, so a screen never hard-codes an emoji.
 */
export const REACTIONS: readonly {
  readonly code: ReactionCode;
  readonly glyph: string;
  readonly label: string;
}[] = [
  { code: "heart", glyph: "❤️", label: "Me encanta" },
  { code: "raisedHands", glyph: "🙌", label: "Celebrar" },
  { code: "fire", glyph: "🔥", label: "Fuego" },
  { code: "clap", glyph: "👏", label: "Aplaudir" },
];

export const glyphOf = (code: ReactionCode): string =>
  REACTIONS.find((reaction) => reaction.code === code)?.glyph ?? "";
