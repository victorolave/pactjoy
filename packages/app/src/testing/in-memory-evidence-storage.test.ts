import { describe, expect, it } from "vitest";
import { instant } from "../time/instant.ts";
import { createFixedClock } from "./fixed-clock.ts";
import { createInMemoryEvidenceStorage } from "./in-memory-evidence-storage.ts";

const NOW = instant(1_791_987_120_000);
const KEY = "o/00000000000000000000000000000000.jpg";

describe("in-memory evidence storage", () => {
  it("signs memory:// URLs that carry the expiry, length and content type", async () => {
    const storage = createInMemoryEvidenceStorage({ clock: createFixedClock(NOW) });
    const signed = await storage.signUpload(KEY, { size: 5, contentType: "image/jpeg" }, 300, NOW);
    expect(signed.url).toBe(
      `memory://entry-photos/${KEY}?exp=${NOW + 300_000}&len=5&ctype=image%2Fjpeg`,
    );
  });

  it("lists the stored keys for assertions", async () => {
    const storage = createInMemoryEvidenceStorage({ clock: createFixedClock(NOW) });
    const signed = await storage.signUpload(KEY, { size: 3, contentType: "image/jpeg" }, 300, NOW);
    expect(storage.keys()).toEqual([]);
    expect(storage.upload(signed, new Uint8Array([1, 2, 3]))).toBe("accepted");
    expect(storage.keys()).toEqual([KEY]);
  });

  it("an adapter failure can be injected for the next call", async () => {
    const storage = createInMemoryEvidenceStorage({ clock: createFixedClock(NOW) });
    storage.failNext("delete", "unavailable");
    await expect(storage.delete(KEY)).rejects.toMatchObject({ code: "unavailable" });
    await expect(storage.delete(KEY)).resolves.toBeUndefined();
  });
});
