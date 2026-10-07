import type { HabitDto, SeasonDto } from "../../../ports/wire.ts";

export const wizardHabit: HabitDto = {
  id: "habit-read",
  name: "Leer",
  why: "Aprender",
  category: "Leer",
  icon: "book",
  createdAt: "2026-10-01T00:00:00.000Z",
  version: 3,
};
export const wizardSeason: SeasonDto = {
  id: "season-wizard",
  circleId: "circle-1",
  timeZone: "UTC",
  nominalStart: "2026-10-08",
  actualStart: null,
  lengthWeeks: 8,
  reviewCadenceWeeks: 2,
  status: "pactOpen",
  approvals: [],
  pactClosedAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  version: 1,
  pactRevision: 1,
  commitments: [
    {
      kind: "detail",
      id: "commitment-read",
      memberId: "member-victor",
      habitId: wizardHabit.id,
      weightPercent: 25,
      privacy: "private",
      habit: { name: wizardHabit.name, icon: wizardHabit.icon },
      measure: {
        unit: "km",
        customLabel: null,
        precision: "decimal",
        target: { direction: "reach", minimum: "0.15", ideal: "0.75" },
        schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [0, 4] } },
      },
    },
  ],
};
