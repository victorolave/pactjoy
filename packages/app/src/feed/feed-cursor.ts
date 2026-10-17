import type { Instant } from "../time/instant.ts";
import { type LocalDate, localDate } from "../time/local-date.ts";
import { parseFeedItemKey } from "./feed-key.ts";

/** The feed is paged by a fixed size (ADR-0018, F10); the client does not choose it. */
export const FEED_PAGE_SIZE = 20;

/** The cursor travels in a URL path (F11), so its length is bounded. */
export const MAX_FEED_CURSOR_LENGTH = 256;

/** What the order needs from an item: the three fields of the sort tuple. */
export interface FeedOrdered {
  readonly key: string;
  readonly onDate: LocalDate;
  readonly at: Instant | null;
}

/** The position of an item in the order: what a cursor remembers. */
export interface FeedPosition {
  readonly onDate: LocalDate;
  readonly at: Instant | null;
  readonly key: string;
}

/**
 * The feed order (F10): newest day first, then newest instant first with dateless items
 * (`at: null`) after the dated ones of the same day, then the key descending. A total order, so
 * a page boundary is never ambiguous. Negative when `a` comes before `b`.
 */
export function compareFeedItems(a: FeedPosition, b: FeedPosition): number {
  if (a.onDate !== b.onDate) return a.onDate > b.onDate ? -1 : 1;
  if (a.at !== b.at) {
    if (a.at === null) return 1;
    if (b.at === null) return -1;
    return a.at > b.at ? -1 : 1;
  }
  if (a.key === b.key) return 0;
  return a.key > b.key ? -1 : 1;
}

/** A sorted copy in the feed order. */
export function sortFeed<T extends FeedOrdered>(items: readonly T[]): T[] {
  return [...items].sort(compareFeedItems);
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const BASE64URL = /^[A-Za-z0-9_-]*$/;

/**
 * Base64url (RFC 4648 section 5, no padding) of ASCII text. The cursor holds ASCII only (a date,
 * digits and a key), and `btoa` is not part of the standard library this package may rely on.
 * @throws {RangeError} if the text has a character beyond ASCII.
 */
export function base64urlEncode(text: string): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code > 0x7f) throw new RangeError("base64urlEncode: only ASCII text is supported");
    buffer = (buffer << 8) | code;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += ALPHABET[(buffer >> bits) & 0x3f];
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(buffer << (6 - bits)) & 0x3f];
  return out;
}

/**
 * The inverse of {@link base64urlEncode}, or `null` for anything that is not exactly what it would
 * have produced (padding, another alphabet, a stray length, leftover bits, a byte beyond ASCII).
 */
export function base64urlDecode(encoded: string): string | null {
  if (!BASE64URL.test(encoded) || encoded.length % 4 === 1) return null;
  let text = "";
  let buffer = 0;
  let bits = 0;
  for (const char of encoded) {
    buffer = (buffer << 6) | ALPHABET.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      const code = (buffer >> bits) & 0xff;
      if (code > 0x7f) return null;
      text += String.fromCharCode(code);
      buffer &= (1 << bits) - 1;
    }
  }
  return base64urlEncode(text) === encoded ? text : null;
}

/** An opaque, URL-safe cursor: the position of the last item of a page. */
export function encodeFeedCursor(position: FeedPosition): string {
  return base64urlEncode(JSON.stringify({ d: position.onDate, a: position.at, k: position.key }));
}

function isInstant(value: unknown): value is Instant {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * The position a cursor stands for, or `null` when it is not exactly a cursor we issued (the
 * caller answers `InvalidFeedCursor`). It comes from a URL, so every part is validated and
 * nothing throws.
 */
export function decodeFeedCursor(cursor: string): FeedPosition | null {
  if (cursor.length === 0 || cursor.length > MAX_FEED_CURSOR_LENGTH) return null;
  const text = base64urlDecode(cursor);
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const fields = parsed as Record<string, unknown>;
  const { d, a, k } = fields;
  if (Object.keys(fields).length !== 3) return null;
  if (typeof d !== "string" || typeof k !== "string") return null;
  if (!(a === null || isInstant(a)) || parseFeedItemKey(k) === null) return null;
  let onDate: LocalDate;
  try {
    onDate = localDate(d);
  } catch {
    return null;
  }
  return { onDate, at: a, key: k };
}

export interface FeedPage<T> {
  readonly items: readonly T[];
  /** The cursor of the next page, or `null` when this one is the last. */
  readonly nextCursor: string | null;
}

/**
 * One page of an already sorted feed: the items strictly AFTER `cursor` (all of them for `null`),
 * at most `size`. The cursor is a position, not an item, so it keeps working when its item has
 * vanished, and a newer item added meanwhile only appears at the top (it neither repeats nor
 * skips anything).
 */
export function pageOf<T extends FeedOrdered>(
  sorted: readonly T[],
  cursor: FeedPosition | null,
  size: number = FEED_PAGE_SIZE,
): FeedPage<T> {
  const remaining =
    cursor === null ? sorted : sorted.filter((item) => compareFeedItems(item, cursor) > 0);
  const items = remaining.slice(0, size);
  const last = items.at(-1);
  const more = remaining.length > items.length;
  return { items, nextCursor: more && last ? encodeFeedCursor(last) : null };
}
