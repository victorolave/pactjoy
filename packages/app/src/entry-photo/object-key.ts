import type { RandomSource } from "../ports/random-source.ts";

/** `o/` plus 32 lowercase hex digits plus `.jpg`: opaque, so a signed URL leaks no id (P2). */
export const OBJECT_KEY_PATTERN = /^o\/[0-9a-f]{32}\.jpg$/;

const HEX = "0123456789abcdef";

/** Mints a new object key. The only place keys come from: never from client input (REQ-S1). */
export function mintObjectKey(random: RandomSource): string {
  let digits = "";
  for (let i = 0; i < 32; i++) digits += HEX.charAt(random.int(16));
  return `o/${digits}.jpg`;
}
