import { type CommitmentId, type MemberId, seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import type { MemberPauseRequest } from "../pause/pause-request.repository.ts";
import { seasonId } from "../shared/ids.ts";
import { createTestApp } from "./app-harness.ts";

const PAUSE: MemberPauseRequest = {
  memberId: "member-1" as MemberId,
  commitmentId: "commitment-1" as CommitmentId,
  requestedOn: seasonDay(1),
  startDay: seasonDay(2),
  end: { kind: "fixed", lastDay: seasonDay(4) },
  decision: { kind: "pending" },
};

describe("in-memory PauseRequestReader", () => {
  it("lists only the pauses seeded for the requested season, through the unit of work", async () => {
    const app = createTestApp();
    app.pauses.add(seasonId("season-1"), PAUSE);
    app.pauses.add(seasonId("season-2"), { ...PAUSE, memberId: "member-2" as MemberId });

    const listed = await app.uow.read((repos) => repos.pauses.listBySeason(seasonId("season-1")));

    expect(listed).toEqual([PAUSE]);
  });

  it("lists nothing for a season without pauses", async () => {
    const app = createTestApp();
    expect(await app.pauses.listBySeason(seasonId("season-9"))).toEqual([]);
  });
});
