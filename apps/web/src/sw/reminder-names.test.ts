import { describe, expect, it } from "vitest";
import { decodeReminderNames, encodeReminderNames, MAX_NAME_LENGTH } from "./reminder-names.ts";

/**
 * The habit names a reminder push may show (D2 owner decision): the push carries ids only, so the
 * app leaves the names of the viewer's OWN VISIBLE commitments on the device, and the worker looks
 * one up. A private commitment's name is never written, so its reminder stays generic on the lock
 * screen. Anything unreadable decodes to no names at all (fail closed).
 */

describe("encodeReminderNames", () => {
  it("keeps the visible commitments only", () => {
    const text = encodeReminderNames([
      { commitmentId: "c-1", habitName: "Leer", privacy: "visible" },
      { commitmentId: "c-2", habitName: "Terapia", privacy: "private" },
    ]);
    expect(text).not.toContain("Terapia");
    expect(decodeReminderNames(text)).toEqual(new Map([["c-1", "Leer"]]));
  });
});

describe("decodeReminderNames", () => {
  it.each([
    ["nothing stored", null],
    ["not JSON", "{oops"],
    ["another version", JSON.stringify({ v: 2, names: { "c-1": "Leer" } })],
    ["names not an object", JSON.stringify({ v: 1, names: ["Leer"] })],
  ])("%s is no names", (_why, text) => {
    expect(decodeReminderNames(text)).toEqual(new Map());
  });

  it("drops a blank, non-string or over-long name, keeping the rest", () => {
    const text = JSON.stringify({
      v: 1,
      names: { a: "  ", b: 7, c: "x".repeat(MAX_NAME_LENGTH + 1), d: " Correr " },
    });
    expect(decodeReminderNames(text)).toEqual(new Map([["d", "Correr"]]));
  });
});
