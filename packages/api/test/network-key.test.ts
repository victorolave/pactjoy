import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createNetworkKeyer } from "../src/http/network-key.ts";

/**
 * A client network is stored only as a keyed hash (ADR-0020, REQ-RL6): HMAC-SHA256 under the
 * server's `API_RATE_LIMIT_KEY`, truncated to 128 bits, base64url. Without the key nobody can
 * test a guess, so a dump of the table does not give the addresses back.
 */
const SECRET = "s".repeat(32);

describe("createNetworkKeyer", () => {
  it("is the base64url of the first 16 bytes of HMAC-SHA256(secret, network)", async () => {
    const expected = createHmac("sha256", SECRET)
      .update("203.0.113.7")
      .digest()
      .subarray(0, 16)
      .toString("base64url");
    expect(await createNetworkKeyer(SECRET)("203.0.113.7")).toBe(expected);
    expect(expected).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("is stable for a network and differs across networks and secrets", async () => {
    const key = createNetworkKeyer(SECRET);
    expect(await key("203.0.113.7")).toBe(await key("203.0.113.7"));
    expect(await key("203.0.113.7")).not.toBe(await key("203.0.113.8"));
    expect(await createNetworkKeyer("t".repeat(32))("203.0.113.7")).not.toBe(
      await key("203.0.113.7"),
    );
  });
});
