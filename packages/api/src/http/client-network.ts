const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV4_WITH_PORT = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/;
const BRACKETED_IPV6 = /^\[([^\]]+)\](?::\d{1,5})?$/;
const HEXTET = /^[0-9A-Fa-f]{1,4}$/;

/** Dotted IPv4 with no leading zeros and every octet up to 255, or null. */
function ipv4(text: string): number[] | null {
  const match = IPV4.exec(text);
  if (match === null) return null;
  const octets = match.slice(1).map((part) => (/^(0|[1-9]\d*)$/.test(part) ? Number(part) : -1));
  return octets.every((o) => o >= 0 && o <= 255) ? octets : null;
}

/** The eight hextets of an IPv6 address (`::` and a trailing dotted IPv4 allowed), or null. */
function ipv6(text: string): number[] | null {
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (half: string): number[] | null => {
    if (half === "") return [];
    const out: number[] = [];
    const parts = half.split(":");
    for (const [i, part] of parts.entries()) {
      const tail = i === parts.length - 1 ? ipv4(part) : null;
      if (tail !== null) {
        out.push(((tail[0] ?? 0) << 8) | (tail[1] ?? 0), ((tail[2] ?? 0) << 8) | (tail[3] ?? 0));
      } else if (HEXTET.test(part)) {
        out.push(Number.parseInt(part, 16));
      } else {
        return null;
      }
    }
    return out;
  };
  const head = parse(halves[0] ?? "");
  const rest = halves.length === 2 ? parse(halves[1] ?? "") : [];
  if (head === null || rest === null) return null;
  const given = head.length + rest.length;
  if (halves.length === 2 ? given > 7 : given !== 8) return null;
  return [...head, ...Array<number>(8 - given).fill(0), ...rest];
}

/**
 * The client network a request is counted against (ADR-0020): the FIRST entry of
 * `X-Forwarded-For`, which the gateway in front of the Edge Function fills with the client it saw.
 * IPv4 is kept as it is; IPv6 is reduced to its /64, because one host or home usually holds a whole
 * /64. `null` when the header is missing or its first entry is not an address.
 *
 * The first entry is used on purpose: a client that forges it only escapes the per-network limit
 * and is still held by the per-user one, while a later entry could be a proxy shared by everyone,
 * which would throttle all users together.
 */
export function clientNetworkOf(headers: Headers): string | null {
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  if (first === "") return null;
  const v4 = ipv4(IPV4_WITH_PORT.exec(first)?.[1] ?? first);
  if (v4 !== null) return v4.join(".");
  const hextets = ipv6(BRACKETED_IPV6.exec(first)?.[1] ?? first);
  if (hextets === null) return null;
  const mapped = hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 0xffff;
  if (mapped) {
    const [high = 0, low = 0] = hextets.slice(6);
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
  }
  return `${hextets
    .slice(0, 4)
    .map((h) => h.toString(16))
    .join(":")}::/64`;
}
