import type {
  CircleFeedDto,
  FeedItemDto,
  FeedMemberDto,
  FeedSubjectDto,
  NudgeDto,
  ReactionsDto,
} from "../../ports/wire.ts";

/** The pair circle of `pairCircleFixture`: Andrea and the viewer, Victor. */
export const ANDREA = "member-andrea";
export const VICTOR = "member-victor";
export const SEASON_ID = "season-1";

export const feedMembersFixture = (): FeedMemberDto[] => [
  { id: ANDREA, displayName: "Andrea", isYou: false, left: false },
  { id: VICTOR, displayName: "Victor", isYou: true, left: false },
];

export const habitSubject = (name: string, icon: string | null = null): FeedSubjectDto => ({
  kind: "habit",
  name,
  icon,
});
export const PRIVATE_SUBJECT: FeedSubjectDto = { kind: "private" };

/** Counts only: reactor identities never travel. A reactable item the viewer has not reacted to. */
export const reactionsFixture = (overrides: Partial<ReactionsDto> = {}): ReactionsDto => ({
  counts: { heart: 0, raisedHands: 0, fire: 0, clap: 0 },
  mine: null,
  reactable: true,
  ...overrides,
});

/** Andrea ran 5 km on the 2nd (a visible commitment with a value). */
export const completedItemFixture = (overrides: Partial<FeedItemDto> = {}): FeedItemDto =>
  ({
    key: "session:commitment-correr:2",
    kind: "completed",
    onDate: "2026-10-02",
    at: "2026-10-02T13:00:00.000Z",
    memberId: ANDREA,
    subject: habitSubject("Correr", "footprints"),
    value: { amount: "5", unit: "km", customLabel: null },
    reactions: reactionsFixture(),
    ...overrides,
  }) as FeedItemDto;

export const consistentWeekItemFixture = (overrides: Partial<FeedItemDto> = {}): FeedItemDto =>
  ({
    key: "week:commitment-meditar:1",
    kind: "consistentWeek",
    onDate: "2026-10-01",
    at: null,
    memberId: ANDREA,
    subject: habitSubject("Meditar"),
    week: 1,
    kept: 7,
    counted: 7,
    reactions: reactionsFixture(),
    ...overrides,
  }) as FeedItemDto;

export const seasonStartedItemFixture = (overrides: Partial<FeedItemDto> = {}): FeedItemDto =>
  ({
    key: "season-start:season-1",
    kind: "seasonStarted",
    onDate: "2026-09-28",
    at: null,
    lengthWeeks: 8,
    ...overrides,
  }) as FeedItemDto;

export const encouragementReceivedItemFixture = (
  overrides: Partial<FeedItemDto> = {},
): FeedItemDto =>
  ({
    key: "encouragement:enc-1",
    kind: "encouragementReceived",
    onDate: "2026-10-02",
    at: "2026-10-02T15:00:00.000Z",
    senderId: ANDREA,
    emoji: "raisedHands",
    ...overrides,
  }) as FeedItemDto;

export const nudgeFixture = (overrides: Partial<NudgeDto> = {}): NudgeDto => ({
  seasonId: SEASON_ID,
  targetId: ANDREA,
  week: 2,
  subject: habitSubject("Correr", "footprints"),
  ...overrides,
});

/** A first page: Andrea's run and week, then the season start; no more pages, no nudge. */
export const feedFixture = (overrides: Partial<CircleFeedDto> = {}): CircleFeedDto => ({
  seasonId: SEASON_ID,
  members: feedMembersFixture(),
  items: [completedItemFixture(), consistentWeekItemFixture(), seasonStartedItemFixture()],
  nextCursor: null,
  nudge: null,
  ...overrides,
});

/** No circle or no started season (`GET /me/feed`): total, never an error. */
export const emptyFeedFixture = (): CircleFeedDto => ({
  seasonId: null,
  members: [],
  items: [],
  nextCursor: null,
  nudge: null,
});
