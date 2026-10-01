// Two things make a string unstorable. A lone surrogate is a UTF-16 unit that is not
// half of a valid pair: it cannot be encoded as UTF-8, so Postgres or JSON.stringify
// would corrupt it (postgres.js turns it into U+FFFD, so distinct keys could collide).
// NUL (U+0000) is rejected by Postgres text and jsonb with a raw 22021 error.
// `String.prototype.isWellFormed` is ES2024 and the lib target is ES2022, hence the regex.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Whether `text` is well-formed UTF-16 (no lone surrogates) and has no NUL. User-provided strings must pass. */
export function isStorableText(text: string): boolean {
  return !text.includes("\u0000") && !LONE_SURROGATE.test(text);
}
