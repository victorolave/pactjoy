import { describe, expect, it } from "vitest";
import { EvidenceStorageError } from "./evidence-storage.ts";

describe("EvidenceStorageError", () => {
  it("carries a code and a fixed message, never the URL or the key", () => {
    const error = new EvidenceStorageError("unavailable");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("EvidenceStorageError");
    expect(error.code).toBe("unavailable");
    expect(error.message).toBe("Evidence storage failed: unavailable");
  });

  it.each(["unavailable", "rejected", "unauthorized"] as const)("accepts the code %s", (code) => {
    expect(new EvidenceStorageError(code).code).toBe(code);
  });
});
