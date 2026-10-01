import { ConcurrencyConflict, InviteCodeGenerationFailed } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import { createThrownMapper } from "../src/errors/thrown.ts";
import { createPipeline } from "../src/http/pipeline.ts";

const info = { requestId: "rid-1" };
const code = (r: ReturnType<ReturnType<typeof createThrownMapper>>) =>
  r && "error" in r ? r.error.code : undefined;

describe("thrown error mapping", () => {
  const map = createThrownMapper();

  it("EM-S9: ConcurrencyConflict is 409", () => {
    expect(map(new ConcurrencyConflict(), info)).toMatchObject({
      status: 409,
      error: { code: "ConcurrencyConflict" },
    });
  });

  it("EM-S10: recognised by name when the class identity differs (duplicate modules)", () => {
    const impostor = Object.assign(new Error("x"), { name: "ConcurrencyConflict" });
    expect(map(impostor, info)).toMatchObject({ status: 409 });
    const gen = Object.assign(new Error("x"), { name: "InviteCodeGenerationFailed" });
    expect(map(gen, info)).toMatchObject({
      status: 500,
      error: { code: "InviteCodeGenerationFailed", details: { requestId: "rid-1" } },
    });
  });

  it("EM-S11: InviteCodeGenerationFailed is 500 with its own code", () => {
    expect(map(new InviteCodeGenerationFailed(), info)).toMatchObject({
      status: 500,
      error: { code: "InviteCodeGenerationFailed", details: { requestId: "rid-1" } },
    });
  });

  it("EM-S12/S13: anything else is 500 Internal with only the requestId, nothing internal", () => {
    const r = map(new Error("password=hunter2 at postgres://u:p@h/db"), info);
    expect(r).toEqual({
      status: 500,
      error: { code: "Internal", message: "Internal", details: { requestId: "rid-1" } },
    });
    expect(JSON.stringify(r)).not.toContain("hunter2");
    expect(code(map("a string", info))).toBe("Internal");
    expect(code(map(null, info))).toBe("Internal");
  });

  it("EM-S14: the injected predicate yields 503 with Retry-After", () => {
    const boom = new Error("connect ECONNREFUSED");
    const unavailable = createThrownMapper((e) => e === boom);
    expect(unavailable(boom, info)).toEqual({
      status: 503,
      error: { code: "ServiceUnavailable", message: "ServiceUnavailable" },
      headers: { "Retry-After": "5" },
    });
    expect(code(unavailable(new Error("other"), info))).toBe("Internal");
  });

  it("a throwing predicate degrades to 500 Internal", () => {
    const m = createThrownMapper(() => {
      throw new Error("predicate bug");
    });
    expect(code(m(new Error("x"), info))).toBe("Internal");
  });

  it("RT-S2, AC-S11: through the pipeline the 409, 503 + Retry-After and 500 reach the wire", async () => {
    let thrown: unknown = new ConcurrencyConflict();
    const handler = createPipeline<string>({
      routes: [
        {
          method: "POST",
          pattern: "/habits",
          handle: async () => {
            throw thrown;
          },
        },
      ],
      authenticate: async () => ({ ok: true, actor: "u" }),
      options: { basePath: "", allowedOrigins: [] },
      onError: createThrownMapper((e) => e instanceof RangeError),
    });
    const post = () =>
      handler(
        new Request("http://x/habits", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
      );
    expect((await post()).status).toBe(409);
    thrown = new RangeError("down");
    const down = await post();
    expect(down.status).toBe(503);
    expect(down.headers.get("Retry-After")).toBe("5");
    expect(down.headers.get("X-Request-Id")).toBeTruthy();
    thrown = new Error("secret");
    const internal = await post();
    expect(internal.status).toBe(500);
    expect(await internal.text()).not.toContain("secret");
  });
});
