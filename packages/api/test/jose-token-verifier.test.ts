import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";
import { createJwksTokenVerifier } from "../src/adapters/jose-token-verifier.ts";

const ISSUER = "https://proj.example/auth/v1";
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
const SUB = "0190a000-0000-7000-8000-000000000001";

type Alg = "ES256" | "RS256";
async function makeKey(alg: Alg, kid: string) {
  const { publicKey, privateKey } = await generateKeyPair(alg);
  return {
    alg,
    kid,
    privateKey,
    jwk: { ...(await exportJWK(publicKey)), alg, kid, use: "sig" } as JWK,
  };
}
const jwksResponse = (...keys: { jwk: JWK }[]) =>
  new Response(JSON.stringify({ keys: keys.map((k) => k.jwk) }), {
    headers: { "content-type": "application/json" },
  });

interface Claims {
  iss?: string;
  aud?: string;
  role?: string | undefined;
  sub?: string | undefined;
  is_anonymous?: unknown;
  exp?: number | string;
  nbf?: number;
}
async function sign(key: Awaited<ReturnType<typeof makeKey>>, claims: Claims = {}) {
  const { exp = "10m", sub = SUB, role, nbf, ...rest } = claims;
  const payload: Record<string, unknown> = {
    ...rest,
    ...("role" in claims ? { role } : { role: "authenticated" }),
  };
  const jwt = new SignJWT(payload)
    .setProtectedHeader({ alg: key.alg, kid: key.kid })
    .setIssuer(claims.iss ?? ISSUER)
    .setAudience(claims.aud ?? "authenticated")
    .setIssuedAt()
    .setExpirationTime(exp);
  if (nbf !== undefined) jwt.setNotBefore(nbf);
  if (claims.sub !== undefined || !("sub" in claims)) jwt.setSubject(sub);
  return jwt.sign(key.privateKey);
}

function setup(
  fetchImpl: (url: string, init?: { signal?: AbortSignal }) => Promise<Response>,
  options = {},
) {
  const fetch = vi.fn(fetchImpl);
  const verifier = createJwksTokenVerifier({
    jwksUrl: JWKS_URL,
    issuer: ISSUER,
    fetch: fetch as never,
    ...options,
  });
  return { verifier, fetch };
}
const reasonOf = async (v: ReturnType<typeof setup>["verifier"], token: string) => {
  const r = await v.verify(token);
  return r.ok ? "accepted" : r.error.reason;
};

describe("jose token verifier", () => {
  it("AU-S7: accepts ES256 and RS256 tokens and yields the user id", async () => {
    const es = await makeKey("ES256", "es");
    const rs = await makeKey("RS256", "rs");
    const { verifier } = setup(async () => jwksResponse(es, rs));
    for (const key of [es, rs])
      expect(await verifier.verify(await sign(key))).toEqual({
        ok: true,
        value: { userId: SUB },
      });
  });

  it("AU-S8: rejects garbage, a wrong signature and an unknown kid", async () => {
    const good = await makeKey("ES256", "k1");
    const forged = await makeKey("ES256", "k1");
    const stranger = await makeKey("ES256", "other");
    const { verifier } = setup(async () => jwksResponse(good));
    expect(await reasonOf(verifier, "not-a-jwt")).toBe("malformed");
    expect(await reasonOf(verifier, await sign(forged))).toBe("invalidSignature");
    expect(await reasonOf(verifier, await sign(stranger))).toBe("invalidSignature");
  });

  it("AU-S9: pins the algorithms: HS256 and alg none are refused", async () => {
    const key = await makeKey("ES256", "k1");
    const { verifier } = setup(async () => jwksResponse(key));
    const hs = await new SignJWT({ role: "authenticated" })
      .setProtectedHeader({ alg: "HS256", kid: "k1" })
      .setIssuer(ISSUER)
      .setAudience("authenticated")
      .setSubject(SUB)
      .setExpirationTime("10m")
      .sign(new TextEncoder().encode("a-shared-secret-of-sufficient-length"));
    expect(await reasonOf(verifier, hs)).toBe("unsupportedAlgorithm");
    const b64 = (o: object) =>
      btoa(JSON.stringify(o)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    const none = `${b64({ alg: "none", kid: "k1" })}.${b64({ iss: ISSUER, aud: "authenticated", sub: SUB, role: "authenticated", exp: 9_999_999_999 })}.`;
    expect(await reasonOf(verifier, none)).toBe("unsupportedAlgorithm");
  });

  it("AU-S10: checks issuer and audience", async () => {
    const key = await makeKey("ES256", "k1");
    const { verifier } = setup(async () => jwksResponse(key));
    expect(await reasonOf(verifier, await sign(key, { iss: "https://evil.example" }))).toBe(
      "wrongIssuer",
    );
    expect(await reasonOf(verifier, await sign(key, { aud: "service" }))).toBe("wrongAudience");
  });

  it("AU-S11: rejects expired tokens (30 s tolerance)", async () => {
    const key = await makeKey("ES256", "k1");
    const { verifier } = setup(async () => jwksResponse(key));
    const now = Math.floor(Date.now() / 1000);
    expect(await reasonOf(verifier, await sign(key, { exp: now - 3600 }))).toBe("expired");
    expect(await reasonOf(verifier, await sign(key, { exp: now - 31 }))).toBe("expired");
    expect(await reasonOf(verifier, await sign(key, { exp: now - 10 }))).toBe("accepted");
  });

  it("a future nbf is refused as notYetValid (beyond the 30 s tolerance)", async () => {
    const key = await makeKey("ES256", "k1");
    const { verifier } = setup(async () => jwksResponse(key));
    const now = Math.floor(Date.now() / 1000);
    expect(await reasonOf(verifier, await sign(key, { nbf: now + 3600 }))).toBe("notYetValid");
    expect(await reasonOf(verifier, await sign(key, { nbf: now + 31 }))).toBe("notYetValid");
    expect(await reasonOf(verifier, await sign(key, { nbf: now + 10 }))).toBe("accepted");
  });

  it("AU-S12: only role authenticated and non-anonymous users pass", async () => {
    const key = await makeKey("ES256", "k1");
    const { verifier } = setup(async () => jwksResponse(key));
    expect(await reasonOf(verifier, await sign(key, { role: "anon" }))).toBe("notAuthenticated");
    expect(await reasonOf(verifier, await sign(key, { role: "service_role" }))).toBe(
      "notAuthenticated",
    );
    expect(await reasonOf(verifier, await sign(key, { role: undefined }))).toBe("notAuthenticated");
    expect(await reasonOf(verifier, await sign(key, { is_anonymous: true }))).toBe(
      "notAuthenticated",
    );
    expect(await reasonOf(verifier, await sign(key, { is_anonymous: false }))).toBe("accepted");
    expect(await reasonOf(verifier, await sign(key, {}))).toBe("accepted");
    for (const is_anonymous of ["true", "false", 1, 0, null, {}])
      expect(
        await reasonOf(verifier, await sign(key, { is_anonymous })),
        String(is_anonymous),
      ).toBe("notAuthenticated");
  });

  it("a token whose header jose cannot process is malformed (401), never keysUnavailable (503)", async () => {
    const key = await makeKey("RS256", "k1");
    const { verifier } = setup(async () => jwksResponse(key));
    const b64 = (o: object) =>
      btoa(JSON.stringify(o)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    const crit = `${b64({ alg: "RS256", kid: "k1", crit: ["x"], x: 1 })}.${b64({ sub: SUB })}.AAAA`;
    expect(await reasonOf(verifier, crit)).toBe("malformed");
  });

  it("the subject must be a canonical lowercase uuid", async () => {
    const key = await makeKey("ES256", "k1");
    const { verifier } = setup(async () => jwksResponse(key));
    for (const sub of ["alice", SUB.toUpperCase(), `${SUB} `, ""])
      expect(await reasonOf(verifier, await sign(key, { sub })), sub).toBe("invalidSubject");
    expect(await reasonOf(verifier, await sign(key, { sub: undefined }))).toBe("invalidSubject");
  });

  it("AU-S13: a JWKS failure (network, 5xx, timeout) is keysUnavailable", async () => {
    const key = await makeKey("ES256", "k1");
    const token = await sign(key);
    const down = setup(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await reasonOf(down.verifier, token)).toBe("keysUnavailable");
    const bad = setup(async () => new Response("boom", { status: 500 }));
    expect(await reasonOf(bad.verifier, token)).toBe("keysUnavailable");
    const slow = setup(
      (_url, init) =>
        new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
        ),
      { timeoutMs: 20 },
    );
    expect(await reasonOf(slow.verifier, token)).toBe("keysUnavailable");
  });

  it("AU-S14: caches the key set, and refetches for a rotated kid after the cooldown", async () => {
    const a = await makeKey("ES256", "a");
    const b = await makeKey("ES256", "b");
    let keys = [a];
    const { verifier, fetch } = setup(async () => jwksResponse(...keys), { cooldownMs: 0 });
    expect(await reasonOf(verifier, await sign(a))).toBe("accepted");
    expect(await reasonOf(verifier, await sign(a))).toBe("accepted");
    expect(fetch).toHaveBeenCalledTimes(1);
    keys = [a, b];
    expect(await reasonOf(verifier, await sign(b))).toBe("accepted");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
