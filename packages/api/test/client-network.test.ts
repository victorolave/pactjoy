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
    expect(of("81.2.69.160")).toBe("81.2.69.160");
    expect(of(" 81.2.69.160 , 10.0.0.1, 172.16.0.1")).toBe("81.2.69.160");
  });

  it("drops an IPv4 port and reads an IPv4-mapped IPv6 address as IPv4", () => {
    expect(of("81.2.69.160:4711")).toBe("81.2.69.160");
    expect(of("::ffff:81.2.69.160")).toBe("81.2.69.160");
  });

  it("reduces IPv6 to its /64, however it is written", () => {
    expect(of("2001:db8:abcd:12:1:2:3:4")).toBe("2001:db8:abcd:12::/64");
    expect(of("2001:DB8:ABCD:0012:ffff::1")).toBe("2001:db8:abcd:12::/64");
    expect(of("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(of("[2001:db8::1]:443")).toBe("2001:db8:0:0::/64");
  });

  it("is null for loopback, unspecified and link-local addresses: they name no client network", () => {
    // Shared buckets anyone could fill by forging them, so they never count (ADR-0020).
    for (const value of [
      "::",
      "::1",
      "::1.2.3.4",
      "0.0.0.0",
      "127.0.0.1",
      "127.8.9.10",
      "169.254.1.2",
      "fe80::1",
      "fe80::1%eth0",
      "::ffff:127.0.0.1",
    ]) {
      expect(of(value), value).toBeNull();
    }
  });

  it("is null for every non-global IPv4 range and any IPv6 outside 2000::/3 (PR #312 W1)", () => {
    // A proxy or container address in front of everyone would otherwise be one bucket for all.
    for (const value of [
      "10.1.2.3",
      "100.64.0.1",
      "100.127.255.254",
      "172.16.0.1",
      "172.31.255.255",
      "192.0.0.8",
      "192.0.2.1",
      "192.168.1.1",
      "198.18.0.1",
      "198.19.255.255",
      "198.51.100.7",
      "203.0.113.7",
      "224.0.0.1",
      "240.0.0.1",
      "255.255.255.255",
      "fd00::1",
      "fc00::1",
      "ff02::1",
      "4000::1",
      "::ffff:10.0.0.1",
    ]) {
      expect(of(value), value).toBeNull();
    }
    // The ranges' neighbours stay global.
    expect(of("100.128.0.1")).toBe("100.128.0.1");
    expect(of("172.32.0.1")).toBe("172.32.0.1");
    expect(of("198.20.0.1")).toBe("198.20.0.1");
    expect(of("3fff::1")).toBe("3fff:0:0:0::/64");
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
