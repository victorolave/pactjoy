import { instant, type PauseRequestRecord, pauseRequestId, seasonId } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import { createEmptyPauseRequestRepository } from "./empty-pause-request-repository.ts";

const SEASON = seasonId("00000000-0000-4000-8000-000000000001");
const REQUEST: PauseRequestRecord = {
  id: pauseRequestId("00000000-0000-4000-8000-000000000002"),
  seasonId: SEASON,
  memberId: "00000000-0000-4000-8000-0000000000a1" as PauseRequestRecord["memberId"],
  reason: "other",
  note: null,
  requestedAt: instant(1_700_000_000_000),
  requestedOn: 0 as PauseRequestRecord["requestedOn"],
  startDay: 0 as PauseRequestRecord["startDay"],
  end: { kind: "open" },
  autoApproveAt: instant(1_700_000_000_000 + 48 * 3_600_000),
  status: "pending",
  decidedAt: null,
  decidedOn: null,
  commitments: [],
  responses: [],
  version: 0,
};

describe("createEmptyPauseRequestRepository (transitional until the pg adapter)", () => {
  it("DC-S12: holds no pause requests for any season, id or deadline", async () => {
    const repository = createEmptyPauseRequestRepository();
    expect(await repository.listBySeason(SEASON)).toEqual([]);
    expect(await repository.listDue(instant(1_700_000_000_000))).toEqual([]);
    expect(await repository.get(REQUEST.id)).toBeNull();
  });

  it("refuses to store anything rather than silently dropping a request", async () => {
    const repository = createEmptyPauseRequestRepository();
    await expect(repository.save(REQUEST, null)).rejects.toThrow(/not implemented/);
  });
});
