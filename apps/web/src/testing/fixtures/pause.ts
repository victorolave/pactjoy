import type {
  MyPauseRequests,
  PauseApprovalDto,
  PauseBudgetDto,
  PauseRequestDto,
} from "../../ports/wire.ts";

/** Wire fixtures for the pause reads; the dates follow the Today fixtures (Friday 2026-10-02). */
export const pauseRequestFixture = (overrides: Partial<PauseRequestDto> = {}): PauseRequestDto => ({
  id: "pause-1",
  status: "pending",
  reason: "health",
  note: null,
  startDate: "2026-10-02",
  endDate: null,
  requestedAt: "2026-10-02T14:12:00.000Z",
  autoApproveAt: "2026-10-04T14:12:00.000Z",
  decidedAt: null,
  commitments: [
    { commitmentId: "commitment-1", habitName: "Meditar", icon: null, resumedOn: null },
  ],
  approvers: [{ memberId: "member-andrea", displayName: "Andrea", response: null }],
  ...overrides,
});

export const pauseApprovalFixture = (
  overrides: Partial<PauseApprovalDto> = {},
): PauseApprovalDto => ({
  id: "pause-9",
  status: "pending",
  reason: "travel",
  note: "Estoy de viaje",
  startDate: "2026-10-03",
  endDate: "2026-10-09",
  requestedAt: "2026-10-02T14:12:00.000Z",
  autoApproveAt: "2026-10-04T14:12:00.000Z",
  requester: { memberId: "member-andrea", displayName: "Andrea" },
  myResponse: null,
  commitments: [{ kind: "visible", commitmentId: "commitment-9", habitName: "Correr", icon: null }],
  ...overrides,
});

export const pauseBudgetFixture = (overrides: Partial<PauseBudgetDto> = {}): PauseBudgetDto => ({
  commitmentId: "commitment-1",
  cap: 14,
  usedDays: 0,
  remainingDays: 14,
  ...overrides,
});

export const noPauseRequestsFixture = (): MyPauseRequests => ({
  seasonId: null,
  mine: [],
  awaitingMe: [],
  budgets: [],
  redistributed: null,
  resumePreviews: [],
});

export const myPauseRequestsFixture = (
  overrides: Partial<MyPauseRequests> = {},
): MyPauseRequests => ({
  seasonId: "season-1",
  mine: [],
  awaitingMe: [],
  budgets: [
    pauseBudgetFixture({ commitmentId: "commitment-1" }),
    pauseBudgetFixture({ commitmentId: "commitment-2" }),
  ],
  redistributed: null,
  resumePreviews: [],
  ...overrides,
});
