import { describe, expect, it } from "vitest";
import { circleId, userId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { createCircle } from "./create-circle.ts";
import { generateInvite } from "./generate-invite.ts";
import { joinCircle } from "./join-circle.ts";
import { leaveCircle } from "./leave-circle.ts";

function actorFor(id: string) {
  return { userId: userId(id) };
}

describe("leaveCircle", () => {
  it("CM-13: marks the member as left, freeing them up to join/create elsewhere (A5)", async () => {
    const app = createTestApp();
    const created = await createCircle(app, actorFor("user-andrea"), { name: "Río Runners" });
    if (!created.ok) throw new Error("fixture setup failed");
    const invite = await generateInvite(app, actorFor("user-andrea"), {
      circleId: created.value.id,
    });
    if (!invite.ok) throw new Error("fixture setup failed");
    const joined = await joinCircle(app, actorFor("user-victor"), {
      inviteCode: invite.value.code,
    });
    if (!joined.ok) throw new Error("fixture setup failed");

    const result = await leaveCircle(app, actorFor("user-victor"), {
      circleId: created.value.id,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const victor = result.value.members.find((m) => m.userId === "user-victor");
    expect(victor?.status).toBe("left");
    expect(victor?.leftAt).toBe(app.clock.now());

    // CM-11 corollary: freed up to create/join a new circle elsewhere.
    const rejoined = await createCircle(app, actorFor("user-victor"), { name: "New circle" });
    expect(rejoined.ok).toBe(true);
  });

  it("keeps the remaining active member(s) unaffected", async () => {
    const app = createTestApp();
    const created = await createCircle(app, actorFor("user-andrea"), { name: "Río Runners" });
    if (!created.ok) throw new Error("fixture setup failed");
    const invite = await generateInvite(app, actorFor("user-andrea"), {
      circleId: created.value.id,
    });
    if (!invite.ok) throw new Error("fixture setup failed");
    await joinCircle(app, actorFor("user-victor"), { inviteCode: invite.value.code });

    const result = await leaveCircle(app, actorFor("user-victor"), {
      circleId: created.value.id,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const andrea = result.value.members.find((m) => m.userId === "user-andrea");
    expect(andrea?.status).toBe("active");
  });

  it("rejects a non-member", async () => {
    const app = createTestApp();
    const created = await createCircle(app, actorFor("user-andrea"), { name: "Río Runners" });
    if (!created.ok) throw new Error("fixture setup failed");

    const result = await leaveCircle(app, actorFor("user-stranger"), {
      circleId: created.value.id,
    });

    expect(result).toEqual({ ok: false, error: { kind: "NotAMember" } });
  });

  it("rejects an unknown circle", async () => {
    const app = createTestApp();

    const result = await leaveCircle(app, actorFor("user-andrea"), {
      circleId: circleId("does-not-exist"),
    });

    expect(result).toEqual({ ok: false, error: { kind: "CircleNotFound" } });
  });

  it("rejects leaving twice", async () => {
    const app = createTestApp();
    const created = await createCircle(app, actorFor("user-andrea"), { name: "Río Runners" });
    if (!created.ok) throw new Error("fixture setup failed");
    const first = await leaveCircle(app, actorFor("user-andrea"), {
      circleId: created.value.id,
    });
    expect(first.ok).toBe(true);

    const second = await leaveCircle(app, actorFor("user-andrea"), {
      circleId: created.value.id,
    });

    expect(second).toEqual({ ok: false, error: { kind: "NotAMember" } });
  });
});
