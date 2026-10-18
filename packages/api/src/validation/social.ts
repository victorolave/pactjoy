import { MAX_FEED_CURSOR_LENGTH, MAX_FEED_KEY_LENGTH } from "@pactjoy/app";
import { uuid } from "./formats.ts";
import { fail, integer, object, type Schema, schema, string } from "./schema.ts";

/** The cursor is opaque base64url (ADR-0018, F10): the alphabet and the length are checked, the content is the app's. */
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export const feedCursorParam: Schema<string> = schema((v, path, sink) => {
  if (typeof v !== "string") return fail(sink, path, "type");
  if (v.length > MAX_FEED_CURSOR_LENGTH) return fail(sink, path, "range");
  return BASE64URL.test(v) ? v : fail(sink, path, "format");
});

/**
 * The item key arrives decoded (`session%3A...` is `session:...`). Only the bound is checked here;
 * whether the key names a real, reactable item is the app's call (`FeedItemNotFound`).
 */
export const feedItemKeyParam: Schema<string> = schema((v, path, sink) => {
  if (typeof v !== "string") return fail(sink, path, "type");
  if (v.length === 0) return fail(sink, path, "format");
  return v.length <= MAX_FEED_KEY_LENGTH ? v : fail(sink, path, "range");
});

/** A 1-based season week; the app owns the live range (`NudgeNotAvailable`). */
const week = integer({ min: 1 });

// The emoji is a plain string: the app owns the closed list (`InvalidReaction`). The member and the
// season come from the token and the path, never the body.
export const reactBody = object({ emoji: string });

export const sendEncouragementBody = object({ recipientId: uuid, week, emoji: string });

export const dismissNudgeBody = object({ targetId: uuid, week });
