import { describe, expect, it } from "vitest";
import type { FeedItemDto, FeedMemberDto, FeedSubjectDto } from "../../../ports/wire.ts";
import {
  ANDREA,
  completedItemFixture,
  consistentWeekItemFixture,
  encouragementReceivedItemFixture,
  feedMembersFixture,
  habitSubject,
  PRIVATE_SUBJECT,
  reactionsFixture,
  seasonStartedItemFixture,
  VICTOR,
} from "../../../testing/fixtures/social.ts";
import { feedLine, subjectsText } from "./feed-copy.ts";

const members = feedMembersFixture();
/** Everyone as a peer: the viewer is somebody else, so the third person is used. */
const peers = members.map((m) => ({ ...m, isYou: false }));
/** The given member is the viewer. */
const youAre = (id: string) => members.map((m) => ({ ...m, isYou: m.id === id }));

const text = (item: FeedItemDto, among: readonly FeedMemberDto[] = members) =>
  feedLine(item, among).text;

const reactions = reactionsFixture();
const base = { onDate: "2026-10-02", at: null } as const;

type Reason = "health" | "travel" | "work" | "other" | null;
const paused = (
  memberId: string,
  subjects: readonly FeedSubjectDto[],
  reason: Reason,
): FeedItemDto =>
  ({
    ...base,
    key: "pause:p1",
    kind: "paused",
    memberId,
    subjects,
    reason,
    reactions,
  }) as FeedItemDto;
const recalc = (subjects: readonly FeedSubjectDto[]): FeedItemDto =>
  ({
    ...base,
    key: "recalc:p1",
    kind: "pointsRecalculated",
    memberId: ANDREA,
    subjects,
  }) as FeedItemDto;
const graduated = (memberId: string, subject: FeedSubjectDto): FeedItemDto =>
  ({
    ...base,
    key: "graduation:h1",
    kind: "graduated",
    memberId,
    subject,
    reactions,
  }) as FeedItemDto;
const comeback = (memberId: string): FeedItemDto =>
  ({ ...base, key: "comeback:m:3", kind: "comeback", memberId, reactions }) as FeedItemDto;
const seasonClosed = (): FeedItemDto =>
  ({ ...base, key: "season-close:s", kind: "seasonClosed" }) as FeedItemDto;

describe("subjectsText", () => {
  it("names visible habits and joins several with commas and 'y'", () => {
    expect(subjectsText([habitSubject("Gym")])).toBe("Gym");
    expect(subjectsText([habitSubject("Gym"), habitSubject("Leer")])).toBe("Gym y Leer");
    expect(subjectsText([habitSubject("Gym"), habitSubject("Leer"), habitSubject("Yoga")])).toBe(
      "Gym, Leer y Yoga",
    );
  });

  it("collapses the private ones into one phrase, counted when there are several", () => {
    expect(subjectsText([PRIVATE_SUBJECT])).toBe("un objetivo privado");
    expect(subjectsText([PRIVATE_SUBJECT, PRIVATE_SUBJECT])).toBe("2 objetivos privados");
    expect(subjectsText([habitSubject("Gym"), PRIVATE_SUBJECT])).toBe("Gym y un objetivo privado");
    expect(
      subjectsText([habitSubject("Gym"), PRIVATE_SUBJECT, habitSubject("Leer"), PRIVATE_SUBJECT]),
    ).toBe("Gym, Leer y 2 objetivos privados");
  });
});

describe("feedLine: a peer's items", () => {
  it("completed, with the amount on a visible commitment", () => {
    expect(text(completedItemFixture())).toBe("Andrea completó Correr · 5 km.");
    const decimal = completedItemFixture({
      value: { amount: "5.5", unit: "km", customLabel: null },
    });
    expect(text(decimal)).toBe("Andrea completó Correr · 5,5 km.");
  });

  it("completed, without an amount for done/not done and for a private commitment", () => {
    expect(text(completedItemFixture({ value: null }))).toBe("Andrea completó Correr.");
    expect(text(completedItemFixture({ value: null, subject: PRIVATE_SUBJECT }))).toBe(
      "Andrea completó un objetivo privado.",
    );
  });

  it("a consistent week with its counts, and without them for a private commitment", () => {
    expect(text(consistentWeekItemFixture())).toBe("Andrea: 7 de 7 en Meditar.");
    const hidden = consistentWeekItemFixture({
      subject: PRIVATE_SUBJECT,
      kept: null,
      counted: null,
    });
    expect(text(hidden)).toBe("Andrea tuvo una semana consistente en un objetivo privado.");
  });

  it("a comeback", () => {
    expect(text(comeback(ANDREA))).toBe("Andrea volvió.");
  });

  it("a pause names the habit and the reason, and hides the reason when everything is private", () => {
    expect(text(paused(VICTOR, [habitSubject("Gym")], "health"), peers)).toBe(
      "Victor pausó Gym · salud.",
    );
    expect(text(paused(VICTOR, [PRIVATE_SUBJECT], null), peers)).toBe(
      "Victor pausó un objetivo privado.",
    );
    expect(text(paused(VICTOR, [PRIVATE_SUBJECT, PRIVATE_SUBJECT], null), peers)).toBe(
      "Victor pausó 2 objetivos privados.",
    );
    const two = paused(VICTOR, [habitSubject("Gym"), habitSubject("Leer")], "travel");
    expect(text(two, peers)).toBe("Victor pausó Gym y Leer · viaje.");
  });

  it("a pause for another reason names no reason", () => {
    expect(text(paused(ANDREA, [habitSubject("Gym")], "other"))).toBe("Andrea pausó Gym.");
    expect(text(paused(ANDREA, [habitSubject("Gym")], "work"))).toBe("Andrea pausó Gym · trabajo.");
  });

  it("points recalculated by a pause, with the masked subjects", () => {
    expect(text(recalc([habitSubject("Gym")]))).toBe(
      "Los puntos se recalcularon por la pausa de Gym.",
    );
    expect(text(recalc([PRIVATE_SUBJECT]))).toBe(
      "Los puntos se recalcularon por la pausa de un objetivo privado.",
    );
  });

  it("a graduation, public and masked when private", () => {
    expect(text(graduated(ANDREA, habitSubject("Leer")))).toBe("Andrea graduó Leer.");
    expect(text(graduated(ANDREA, PRIVATE_SUBJECT))).toBe("Andrea graduó un objetivo privado.");
  });

  it("the season start and end", () => {
    expect(text(seasonStartedItemFixture())).toBe("Empezó la temporada de 8 semanas.");
    expect(text(seasonClosed())).toBe("La temporada terminó.");
  });

  it("a received encouragement says who sent which emoji and nothing else", () => {
    expect(text(encouragementReceivedItemFixture())).toBe("Andrea te envió 🙌");
    expect(text(encouragementReceivedItemFixture({ emoji: "fire" } as never))).toBe(
      "Andrea te envió 🔥",
    );
  });
});

describe("feedLine: the viewer's own items speak to them", () => {
  const you = youAre(ANDREA);

  it("uses the second person", () => {
    expect(text(completedItemFixture(), you)).toBe("Completaste Correr · 5 km.");
    const secret = completedItemFixture({ value: null, subject: PRIVATE_SUBJECT });
    expect(text(secret, you)).toBe("Completaste un objetivo privado.");
    expect(text(paused(ANDREA, [habitSubject("Gym")], "health"), you)).toBe(
      "Pausaste Gym · salud.",
    );
    expect(text(consistentWeekItemFixture(), you)).toBe("Tú: 7 de 7 en Meditar.");
    const hidden = consistentWeekItemFixture({
      subject: PRIVATE_SUBJECT,
      kept: null,
      counted: null,
    });
    expect(text(hidden, you)).toBe("Tuviste una semana consistente en un objetivo privado.");
    expect(text(comeback(ANDREA), you)).toBe("Volviste.");
    expect(text(graduated(ANDREA, habitSubject("Leer")), you)).toBe("Graduaste Leer.");
  });
});

describe("feedLine: a member who left", () => {
  const left = members.map((m) => (m.id === ANDREA ? { ...m, left: true } : m));

  it("is named as someone who left, never by name", () => {
    expect(text(completedItemFixture(), left)).toBe("Un miembro que salió completó Correr · 5 km.");
    expect(feedLine(completedItemFixture(), left).avatarName).toBe("?");
  });
});

describe("feedLine: the avatar and the icon", () => {
  it("shows the actor's avatar on member items and an icon on system items", () => {
    expect(feedLine(completedItemFixture(), members)).toMatchObject({
      avatarName: "Andrea",
      icon: null,
    });
    expect(feedLine(seasonStartedItemFixture(), members)).toMatchObject({
      avatarName: null,
      icon: "calendar-days",
    });
    expect(feedLine(seasonClosed(), members).icon).toBe("circle-check");
    expect(feedLine(recalc([PRIVATE_SUBJECT]), members).icon).toBe("refresh-cw");
  });
});

describe("feedLine: tone", () => {
  it("never uses shaming words, whatever the item", () => {
    const items: FeedItemDto[] = [
      completedItemFixture(),
      consistentWeekItemFixture(),
      seasonStartedItemFixture(),
      encouragementReceivedItemFixture(),
      paused(ANDREA, [PRIVATE_SUBJECT], null),
    ];
    for (const item of items) {
      expect(feedLine(item, members).text).not.toMatch(
        /fall|fracas|perdi|abandon|rach|atrás|vago|flojo|culpa/i,
      );
    }
  });
});
