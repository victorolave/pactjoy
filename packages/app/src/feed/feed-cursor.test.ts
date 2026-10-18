import { describe, expect, it } from "vitest";
import { instant } from "../time/instant.ts";
import { type LocalDate, localDate } from "../time/local-date.ts";
import {
  base64urlDecode,
  base64urlEncode,
  compareFeedItems,
  decodeFeedCursor,
  encodeFeedCursor,
  FEED_PAGE_SIZE,
  MAX_FEED_CURSOR_LENGTH,
  pageOf,
  sortFeed,
} from "./feed-cursor.ts";

const item = (key: string, onDate: string, at: number | null) => ({
  key,
  onDate: localDate(onDate) as LocalDate,
  at: at === null ? null : instant(at),
});

const keys = (items: readonly { readonly key: string }[]) => items.map((i) => i.key);
const b64url = base64urlEncode;

describe("feed order (F10): newest day first, then newest instant, dateless last, key descending", () => {
  it("sorts by day, then by instant, then dateless items, then by key", () => {
    const sorted = sortFeed([
      item("session:a:1", "2026-10-01", 100),
      item("season-start:s", "2026-10-01", null),
      item("session:a:3", "2026-10-03", 50),
      item("session:a:2", "2026-10-01", 900),
      item("week:x:1", "2026-10-01", null),
    ]);
    expect(keys(sorted)).toEqual([
      "session:a:3",
      "session:a:2",
      "session:a:1",
      "week:x:1",
      "season-start:s",
    ]);
  });

  it("is a total order: equal day and instant fall back to the key", () => {
    const a = item("pause:b", "2026-10-02", 10);
    const b = item("recalc:b", "2026-10-02", 10);
    expect(compareFeedItems(a, b)).toBeGreaterThan(0);
    expect(compareFeedItems(b, a)).toBeLessThan(0);
    expect(compareFeedItems(a, a)).toBe(0);
  });

  it("does not mutate its input", () => {
    const input = [item("a:1", "2026-10-01", 1), item("b:1", "2026-10-02", 1)];
    sortFeed(input);
    expect(keys(input)).toEqual(["a:1", "b:1"]);
  });
});

describe("cursor encoding", () => {
  it("round-trips a position with an instant and one without", () => {
    for (const position of [
      { onDate: localDate("2026-10-05"), at: instant(1_791_987_120_000), key: "session:c-1:3" },
      { onDate: localDate("2026-10-05"), at: null, key: "season-start:s-1" },
    ]) {
      const cursor = encodeFeedCursor(position);
      expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(cursor.length).toBeLessThanOrEqual(MAX_FEED_CURSOR_LENGTH);
      expect(decodeFeedCursor(cursor)).toEqual(position);
    }
  });

  it.each([
    ["empty", ""],
    ["not base64url", "!!!!"],
    ["too long", "a".repeat(MAX_FEED_CURSOR_LENGTH + 1)],
    ["not JSON", b64url("hello")],
    ["JSON of the wrong shape", b64url('{"x":1}')],
    ["an array", b64url("[1,2,3]")],
    ["a date that does not exist", b64url('{"d":"2026-02-31","a":null,"k":"pause:x"}')],
    ["a negative instant", b64url('{"d":"2026-10-01","a":-1,"k":"pause:x"}')],
    ["a fractional instant", b64url('{"d":"2026-10-01","a":1.5,"k":"pause:x"}')],
    ["a string instant", b64url('{"d":"2026-10-01","a":"1","k":"pause:x"}')],
    ["a key that is not ours", b64url('{"d":"2026-10-01","a":null,"k":"entry:1"}')],
    ["an extra field", b64url('{"d":"2026-10-01","a":null,"k":"pause:x","z":1}')],
  ])("rejects a cursor that is %s", (_name, raw) => {
    expect(decodeFeedCursor(raw)).toBeNull();
  });

  it("rejects a non-canonical encoding of a valid cursor", () => {
    const valid = encodeFeedCursor({
      onDate: localDate("2026-10-05"),
      at: null,
      key: "pause:x",
    });
    expect(decodeFeedCursor(`${valid}=`)).toBeNull();
  });
});

describe("paging (F10)", () => {
  const many = (count: number) =>
    sortFeed(
      Array.from({ length: count }, (_, index) =>
        item(
          `session:c-1:${index + 1}`,
          `2026-10-${String((index % 27) + 1).padStart(2, "0")}`,
          index,
        ),
      ),
    );

  it("fixes the page size at 20", () => {
    expect(FEED_PAGE_SIZE).toBe(20);
  });

  it("pages 45 items as 20, 20 and 5 with no repeat and no gap", () => {
    const all = many(45);
    const first = pageOf(all, null);
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).not.toBeNull();
    const second = pageOf(all, decodeFeedCursor(first.nextCursor ?? ""));
    expect(second.items).toHaveLength(20);
    const third = pageOf(all, decodeFeedCursor(second.nextCursor ?? ""));
    expect(third.items).toHaveLength(5);
    expect(third.nextCursor).toBeNull();
    expect([...first.items, ...second.items, ...third.items]).toEqual(all);
  });

  it("an exact multiple of the page size has no empty last page", () => {
    const all = many(20);
    expect(pageOf(all, null).nextCursor).toBeNull();
  });

  it("a newer item added between pages neither repeats nor skips an item", () => {
    const all = many(30);
    const first = pageOf(all, null);
    const newer = item("pause:new", "2026-12-31", 9_999);
    const second = pageOf(sortFeed([...all, newer]), decodeFeedCursor(first.nextCursor ?? ""));
    expect([...first.items, ...second.items]).toEqual(all);
  });

  it("a cursor whose item has since vanished still resumes right after its position", () => {
    const all = many(30);
    const first = pageOf(all, null);
    const lastShown = first.items.at(-1);
    const without = all.filter((candidate) => candidate.key !== lastShown?.key);
    const second = pageOf(without, decodeFeedCursor(first.nextCursor ?? ""));
    expect(second.items[0]).toEqual(all[20]);
  });

  it("an empty feed is an empty page", () => {
    expect(pageOf([], null)).toEqual({ items: [], nextCursor: null });
  });
});

describe("base64url of ASCII text (the cursor's only codec)", () => {
  it("matches the RFC 4648 vectors, unpadded and url-safe", () => {
    expect(base64urlEncode("")).toBe("");
    expect(base64urlEncode("f")).toBe("Zg");
    expect(base64urlEncode("fo")).toBe("Zm8");
    expect(base64urlEncode("foo")).toBe("Zm9v");
    expect(base64urlEncode("foobar")).toBe("Zm9vYmFy");
    expect(base64urlEncode("??>>")).toBe("Pz8-Pg");
  });

  it("decodes what it encodes, and refuses what it did not", () => {
    for (const text of ["", "f", "fo", "foo", '{"d":"2026"}', "??>>"]) {
      expect(base64urlDecode(base64urlEncode(text))).toBe(text);
    }
    expect(base64urlDecode("Z")).toBeNull();
    expect(base64urlDecode("Zh")).toBeNull();
    expect(base64urlDecode("Zg==")).toBeNull();
    expect(base64urlDecode("Zg+/")).toBeNull();
  });

  it("refuses text beyond ASCII", () => {
    expect(() => base64urlEncode("ñ")).toThrow(RangeError);
  });
});
