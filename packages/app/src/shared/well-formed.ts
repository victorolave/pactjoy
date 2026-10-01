// A lone surrogate is a UTF-16 unit that is not half of a valid pair. It cannot be
// encoded as UTF-8, so Postgres or JSON.stringify would corrupt or reject it.
// `String.prototype.isWellFormed` is ES2024 and the lib target is ES2022, hence the regex.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Whether `text` is well-formed UTF-16: no lone surrogates. User-provided strings must pass. */
export function isWellFormed(text: string): boolean {
  return !LONE_SURROGATE.test(text);
}
