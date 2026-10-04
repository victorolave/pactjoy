import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../ports/api-error.ts";
import { HttpPactJoyApi } from "./http-pactjoy-api.ts";

const BASE = "http://api.test/api";
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function harness(response: Response) {
  const fetchStub = vi.fn<typeof fetch>(async () => response);
  const api = new HttpPactJoyApi({
    baseUrl: BASE,
    getAccessToken: async () => "t1",
    refreshAccessToken: async () => ({ status: "rejected" }),
    onUnauthorized: () => {},
    fetch: fetchStub,
  });
  const sent = () => {
    const [url, init] = fetchStub.mock.calls[0] ?? [];
    return {
      url: String(url),
      method: init?.method,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
  };
  return { api, sent };
}

const MY_CIRCLE = { circle: null, season: null };
const INVITE = { code: "7K4Q2M", createdAt: "2026-10-01T00:00:00.000Z", expiresAt: "x" };

describe("HttpPactJoyApi circle methods", () => {
  it("getMyCircle reads GET /me/circle and keeps the nulls", async () => {
    const { api, sent } = harness(json(200, { data: MY_CIRCLE }));
    await expect(api.getMyCircle()).resolves.toEqual(MY_CIRCLE);
    expect([sent().method, sent().url]).toEqual(["GET", `${BASE}/me/circle`]);
  });

  it("getMyCircle rejects a 2xx that is not the read model as Internal", async () => {
    const { api } = harness(json(200, { data: "nope" }));
    await expect(api.getMyCircle()).rejects.toMatchObject({ code: "Internal" });
  });

  it("previewInvite posts the code in the body, never in the URL", async () => {
    const preview = { circleName: "Crew", invitedBy: null, activeMemberCount: 1, expiresAt: "x" };
    const { api, sent } = harness(json(200, { data: preview }));
    await expect(api.previewInvite("7K4Q2M")).resolves.toEqual(preview);
    expect(sent()).toEqual({
      method: "POST",
      url: `${BASE}/circles/join/preview`,
      body: { inviteCode: "7K4Q2M" },
    });
  });

  it("createCircle and joinCircle keep only the circle id", async () => {
    const create = harness(json(201, { data: { id: "c-1", name: "Crew", members: [] } }));
    await expect(create.api.createCircle({ name: "Crew", displayName: "Andrea" })).resolves.toEqual(
      {
        circleId: "c-1",
      },
    );
    expect(create.sent()).toMatchObject({
      method: "POST",
      url: `${BASE}/circles`,
      body: { name: "Crew", displayName: "Andrea" },
    });
    const join = harness(json(200, { data: { id: "c-2" } }));
    await expect(
      join.api.joinCircle({ inviteCode: "7K4Q2M", displayName: "Vic" }),
    ).resolves.toEqual({ circleId: "c-2" });
    expect(join.sent()).toMatchObject({ url: `${BASE}/circles/join` });
  });

  it("generateInvite posts to the circle's invite path and returns the invite", async () => {
    const { api, sent } = harness(json(201, { data: INVITE }));
    await expect(api.generateInvite("c 1")).resolves.toEqual(INVITE);
    expect([sent().method, sent().url]).toEqual(["POST", `${BASE}/circles/c%201/invite`]);
  });

  it("renames and leaves with the right verb, path and body", async () => {
    const rename = harness(json(200, { data: { id: "c-1" } }));
    await rename.api.renameCircle("c-1", "Nuevo");
    expect(rename.sent()).toEqual({
      method: "PATCH",
      url: `${BASE}/circles/c-1`,
      body: { name: "Nuevo" },
    });
    const me = harness(json(200, { data: { id: "c-1" } }));
    await me.api.renameMyDisplayName("c-1", "Vic");
    expect(me.sent()).toEqual({
      method: "PATCH",
      url: `${BASE}/circles/c-1/members/me`,
      body: { displayName: "Vic" },
    });
    const leave = harness(json(200, { data: { id: "c-1" } }));
    await leave.api.leaveCircle("c-1");
    expect([leave.sent().method, leave.sent().url]).toEqual(["POST", `${BASE}/circles/c-1/leave`]);
  });

  it("maps the API's error codes to ApiError", async () => {
    const { api } = harness(json(409, { error: { code: "CircleFull", message: "x" } }));
    const error = await api.joinCircle({ inviteCode: "7K4Q2M", displayName: "V" }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "CircleFull", status: 409 });
  });
});
