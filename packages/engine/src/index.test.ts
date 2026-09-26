import { describe, expect, it } from "vitest";
import { ENGINE_VERSION } from "./index";

describe("@pactjoy/engine", () => {
  it("exposes a version placeholder", () => {
    expect(ENGINE_VERSION).toBe("0.0.0");
  });
});
