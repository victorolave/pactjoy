import { describe, expect, it } from "vitest";
import { reactionsFixture } from "../../../testing/fixtures/social.ts";
import { applyReaction } from "./apply-reaction.ts";

describe("applyReaction (the optimistic chip update)", () => {
  it("adds the viewer's first reaction", () => {
    expect(applyReaction(reactionsFixture(), "heart")).toEqual(
      reactionsFixture({ counts: { heart: 1, raisedHands: 0, fire: 0, clap: 0 }, mine: "heart" }),
    );
  });

  it("moves it when the viewer picks another emoji, never counting two", () => {
    const before = reactionsFixture({
      counts: { heart: 2, raisedHands: 0, fire: 0, clap: 0 },
      mine: "heart",
    });
    expect(applyReaction(before, "fire")).toEqual(
      reactionsFixture({ counts: { heart: 1, raisedHands: 0, fire: 1, clap: 0 }, mine: "fire" }),
    );
  });

  it("takes it back with null, leaving the other people's counts", () => {
    const before = reactionsFixture({
      counts: { heart: 2, raisedHands: 1, fire: 0, clap: 0 },
      mine: "heart",
    });
    expect(applyReaction(before, null)).toEqual(
      reactionsFixture({ counts: { heart: 1, raisedHands: 1, fire: 0, clap: 0 }, mine: null }),
    );
  });

  it("removing when there was nothing changes nothing", () => {
    expect(applyReaction(reactionsFixture(), null)).toEqual(reactionsFixture());
  });

  it("does not mutate its input and keeps the reactable flag", () => {
    const before = reactionsFixture({ reactable: false });
    const after = applyReaction(before, "clap");
    expect(before.counts.clap).toBe(0);
    expect(after.reactable).toBe(false);
  });
});
