import { describe, expect, it } from "vitest";
import { graduationNote } from "./graduation-note.ts";

const visible = { habit: "Leer", viewerName: "Victor", isPrivate: false } as const;

describe("graduationNote (38b: what the circle will read)", () => {
  it("names the one peer who will see the line, as the design does", () => {
    expect(graduationNote({ ...visible, peers: ["Andrea"] })).toBe(
      "Andrea verá “Victor graduó Leer” en la actividad del círculo.",
    );
  });

  it("names several peers with commas and 'y'", () => {
    expect(graduationNote({ ...visible, peers: ["Andrea", "Carla"] })).toBe(
      "Andrea y Carla verán “Victor graduó Leer” en la actividad del círculo.",
    );
    expect(graduationNote({ ...visible, peers: ["Andrea", "Carla", "Dani"] })).toBe(
      "Andrea, Carla y Dani verán “Victor graduó Leer” en la actividad del círculo.",
    );
  });

  it("falls back to 'Tu círculo' when it cannot name anyone", () => {
    expect(graduationNote({ ...visible, peers: [] })).toBe(
      "Tu círculo verá “Victor graduó Leer” en la actividad del círculo.",
    );
  });

  it("does not name the habit when it is private, nor the people", () => {
    expect(graduationNote({ ...visible, peers: ["Andrea"], isPrivate: true })).toBe(
      "Tu círculo verá que graduaste un objetivo privado.",
    );
  });

  it("does not claim to know the name of the viewer when it is not known", () => {
    expect(
      graduationNote({ habit: "Leer", viewerName: null, peers: ["Andrea"], isPrivate: false }),
    ).toBe("Andrea verá que graduaste Leer en la actividad del círculo.");
  });
});
