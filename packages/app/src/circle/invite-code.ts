import type { RandomSource } from "../ports/random-source.ts";
import { type Instant, instant } from "../time/instant.ts";

/**
 * A circle invite code (CM-3, A1, Notion): 6 characters, drawn from an
 * alphabet without ambiguous characters (no 0/O, 1/I/L), case-insensitive.
 * The only way to produce one in production is {@link generateInviteCode}.
 */
export type InviteCode = string & { readonly __brand: "InviteCode" };

const SAFE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 6;
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

function pickChar(random: RandomSource): string {
  const index = random.int(SAFE_ALPHABET.length);
  const char = SAFE_ALPHABET[index];
  if (char === undefined) {
    throw new RangeError(`generateInviteCode: RandomSource produced out-of-range index ${index}`);
  }
  return char;
}

/** Draws a fresh 6-character {@link InviteCode} from the safe alphabet (CM-3). */
export function generateInviteCode(random: RandomSource): InviteCode {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += pickChar(random);
  }
  return code as InviteCode;
}

/** An invite generated at `generatedAt` expires exactly 7 days later (CM-3, Notion). */
export function inviteCodeExpiresAt(generatedAt: Instant): Instant {
  return instant(generatedAt + EXPIRY_MS);
}

/** Normalizes user input for case-insensitive comparison against a stored {@link InviteCode}. */
export function normalizeInviteCode(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * True when `value`, once normalized (trim + uppercase, like a join), is
 * exactly {@link CODE_LENGTH} characters of the safe alphabet. Lets a
 * boundary reject malformed codes without a lookup; same alphabet and
 * length as {@link generateInviteCode}.
 */
export function isInviteCodeFormat(value: string): boolean {
  const code = normalizeInviteCode(value);
  return code.length === CODE_LENGTH && [...code].every((char) => SAFE_ALPHABET.includes(char));
}

/** Test-only escape hatch to plant a known, fixed code in a fixture (bypasses {@link generateInviteCode}). */
export function inviteCode(value: string): InviteCode {
  return value as InviteCode;
}
