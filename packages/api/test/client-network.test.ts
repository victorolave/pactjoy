import { describe, expect, it } from "vitest";
import { clientNetworkOf } from "../src/http/client-network.ts";

/**
 * The client network a join attempt is counted against (ADR-0020, REQ-RL5): the FIRST entry of
 * `X-Forwarded-For`, IPv4 as it is and IPv6 reduced to its /64 (one host usually holds a whole
 * /64). Anything that is not an address is `null`: then only the per-user limits apply.
 */
const of = (value: string | null) =>
  clientNetworkOf(new Headers(value === null ? {} : { "x-forwarded-for": value }));

describe("clientNetworkOf", () => {
  it("takes the first entry of X-Forwarded-For", () => {
    expect(of("203.0.113.7")).toBe("203.0.113.7");
    expect(of(" 203.0.113.7 , 10.0.0.1, 172.16.0.1")).toBe("203.0.113.7");
  });

  it("drops an IPv4 port and reads an IPv4-mapped IPv6 address as IPv4", () => {
    expect(of("203.0.113.7:4711")).toBe("203.0.113.7");
    expect(of("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it("reduces IPv6 to its /64, however it is written", () => {
    expect(of("2001:db8:abcd:12:1:2:3:4")).toBe("2001:db8:abcd:12::/64");
    expect(of("2001:DB8:ABCD:0012:ffff::1")).toBe("2001:db8:abcd:12::/64");
    expect(of("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(of("[2001:db8::1]:443")).toBe("2001:db8:0:0::/64");
    expect(of("::1")).toBe("0:0:0:0::/64");
  });

  it("is null without the header or for anything that is not an address", () => {
    for (const value of [
      null,
      "",
      " , 203.0.113.7",
      "unknown",
      "256.1.1.1",
      "1.2.3",
      "01.2.3.4",
      "1.2.3.4.5",
      "2001:db8::1::2",
      "2001:db8:1:2:3:4:5:6:7",
      "g::1",
      "12345::1",
    ]) {
      expect(of(value), String(value)).toBeNull();
    }
  });
});
