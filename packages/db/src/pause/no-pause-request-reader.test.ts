import { seasonId } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import { createNoPauseRequestReader } from "./no-pause-request-reader.ts";

describe("createNoPauseRequestReader (temporary until A2)", () => {
  it("DC-S12: reports no pauses for any season", async () => {
    const reader = createNoPauseRequestReader();
    expect(await reader.listBySeason(seasonId("00000000-0000-4000-8000-000000000001"))).toEqual([]);
    expect(await reader.listBySeason(seasonId("00000000-0000-4000-8000-000000000002"))).toEqual([]);
  });
});
