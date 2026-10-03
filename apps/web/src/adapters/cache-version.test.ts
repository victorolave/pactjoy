import { describe, expect, it } from "vitest";
import {
  activeTodayFixture,
  dayRowFixture,
  entryFixture,
  noSeasonTodayFixture,
  pendingItemFixture,
  weekRowFixture,
} from "../testing/fixtures/today.ts";
import { CACHE_VERSION } from "./query-persister.ts";

/** Every key path of a JSON value, arrays collapsed to `[]`: the shape of a Today, not its data. */
function shape(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => shape(item, `${path}[]`));
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => [
      `${path}.${key}`,
      ...shape(child, `${path}.${key}`),
    ]);
  }
  return [];
}

/** FNV-1a, 32 bit: enough to notice any change in the list of paths. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (const char of text) {
    h ^= char.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const complete = [
  activeTodayFixture({
    pendingYesterday: [pendingItemFixture()],
    rows: [
      dayRowFixture({ entries: [entryFixture({ kind: "quantity", value: "3" })] }),
      weekRowFixture({ entries: [entryFixture({ kind: "done" })] }),
    ],
  }),
  noSeasonTodayFixture(),
];

const paths = [...new Set(complete.flatMap((view) => shape(view)))].sort();

/**
 * The saved Today is restored into whatever code runs after a deploy. When its shape changes, an
 * old saved copy must be dropped instead of rendered: CACHE_VERSION in query-persister.ts is what
 * drops it. This pins the shape and the version together, so changing one without the other fails.
 * If you changed the Today fixtures' shape on purpose: bump CACHE_VERSION, then update both here.
 */
const PINNED = { hash: "9d2650ef", version: "3" };

describe("saved Today cache version", () => {
  it("changes whenever the shape of Today changes", () => {
    expect({ hash: hash(paths.join("\n")), version: CACHE_VERSION }).toEqual(PINNED);
  });
});
