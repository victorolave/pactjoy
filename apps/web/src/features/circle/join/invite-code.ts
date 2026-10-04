/**
 * The characters an invite code can contain. Mirrors `SAFE_ALPHABET` in `packages/app`
 * (`invite-code.ts`): no 0/O, 1/I/L. The web never imports app runtime code, so it keeps its own
 * copy; a code outside it can only be answered with "not found", so filtering it early is safe.
 */
export const INVITE_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** An invite code is always this long. */
export const INVITE_CODE_LENGTH = 6;
