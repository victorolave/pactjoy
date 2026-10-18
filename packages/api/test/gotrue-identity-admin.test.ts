import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { userId } from "@pactjoy/app";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGoTrueIdentityAdmin } from "../src/adapters/gotrue-identity-admin.ts";

// Deliberately synthetic, built here; never load credentials for this contract.
const KEY = ["sb", "secret", "contract-fixture-not-a-key"].join("_");
const ID = userId("0190a000-0000-7000-8000-000000000001");
const servers: ReturnType<typeof createServer>[] = [];

async function stub(handle: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handle);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("stub did not bind");
  return `http://127.0.0.1:${address.port}/auth/v1`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        }),
    ),
  );
});

describe("GoTrue identity deletion contract (local HTTP only)", () => {
  it("sends a hard DELETE with apikey only for an opaque secret and no redirects", async () => {
    const requests: object[] = [];
    const authUrl = await stub((req, res) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        requests.push({
          method: req.method,
          path: req.url,
          key: req.headers.apikey,
          authorization: req.headers.authorization,
          contentType: req.headers["content-type"],
          body,
        });
        res.writeHead(200).end("{}");
      });
    });
    const injectedFetch = vi.fn<typeof fetch>((url, init) => fetch(url, init));
    const admin = createGoTrueIdentityAdmin({
      authUrl: `${authUrl}/`,
      adminKey: KEY,
      fetch: injectedFetch,
    });
    await expect(admin.deleteUser(ID)).resolves.toBeUndefined();
    expect(requests).toEqual([
      {
        method: "DELETE",
        path: `/auth/v1/admin/users/${ID}`,
        key: KEY,
        authorization: undefined,
        contentType: "application/json",
        body: '{"should_soft_delete":false}',
      },
    ]);
    expect(injectedFetch.mock.calls[0]?.[1]).toMatchObject({
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
  });

  it("never builds a Bearer header, whatever shape the credential has", async () => {
    const syntheticJwt = ["synthetic", "header", "signature"].join(".");
    const received: object[] = [];
    const authUrl = await stub((req, res) => {
      received.push({ key: req.headers.apikey, authorization: req.headers.authorization });
      res.writeHead(204).end();
    });
    await createGoTrueIdentityAdmin({ authUrl, adminKey: syntheticJwt, fetch }).deleteUser(ID);
    expect(received).toEqual([{ key: syntheticJwt, authorization: undefined }]);
  });

  it.each([200, 204])("treats %i as success, including idempotent repeats", async (status) => {
    let calls = 0;
    const authUrl = await stub((_req, res) => {
      calls++;
      res.writeHead(status).end();
    });
    const admin = createGoTrueIdentityAdmin({ authUrl, adminKey: KEY, fetch });
    await admin.deleteUser(ID);
    await admin.deleteUser(ID);
    expect(calls).toBe(2);
  });

  it.each([
    ["error_code", { error_code: "user_not_found", msg: "User not found" }],
    ["older msg only", { code: 404, msg: "User not found" }],
  ])(
    "treats a GoTrue user-not-found 404 (%s) as success, including repeats",
    async (_name, body) => {
      let calls = 0;
      const authUrl = await stub((_req, res) => {
        calls++;
        res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify(body));
      });
      const admin = createGoTrueIdentityAdmin({ authUrl, adminKey: KEY, fetch });
      await admin.deleteUser(ID);
      await admin.deleteUser(ID);
      expect(calls).toBe(2);
    },
  );

  it.each([
    ["an empty body", ""],
    ["an HTML page", "<html><body>404 Not Found</body></html>"],
    ["another error code", JSON.stringify({ error_code: "no_authorization", msg: "nope" })],
    ["a gateway route miss", JSON.stringify({ message: "no Route matched with those values" })],
    ["a truncated JSON", '{"error_code":"user_not_fo'],
  ])("rejects a 404 with %s as unavailable", async (_name, body) => {
    const authUrl = await stub((_req, res) => {
      res.writeHead(404).end(body);
    });
    const admin = createGoTrueIdentityAdmin({ authUrl, adminKey: KEY, fetch });
    const failure = await admin.deleteUser(ID).catch((error: unknown) => error);
    expect(failure).toMatchObject({ name: "IdentityAdminError", code: "unavailable" });
    expect(failure).not.toHaveProperty("cause");
  });

  it("does not read an unbounded 404 body to decide", async () => {
    const authUrl = await stub((_req, res) => {
      // user_not_found sits beyond any sane bound: the decision must not wait for it.
      res.writeHead(404).end(`${" ".repeat(100_000)}{"error_code":"user_not_found"}`);
    });
    const admin = createGoTrueIdentityAdmin({ authUrl, adminKey: KEY, fetch });
    await expect(admin.deleteUser(ID)).rejects.toMatchObject({ code: "unavailable" });
  });

  it.each([401, 403, 400, 429, 500, 503])(
    "sanitizes status %i without exposing the response",
    async (status) => {
      const authUrl = await stub((_req, res) => {
        res.writeHead(status).end(`sensitive ${KEY} ${ID}`);
      });
      const admin = createGoTrueIdentityAdmin({ authUrl, adminKey: KEY, fetch });
      const code = status === 401 || status === 403 ? "rejected" : "unavailable";
      const failure = await admin.deleteUser(ID).catch((error: unknown) => error);
      expect(failure).toMatchObject({ name: "IdentityAdminError", code, message: code });
      expect(failure).not.toHaveProperty("cause");
    },
  );

  it("times out a request that never receives headers", async () => {
    const authUrl = await stub(() => {});
    const admin = createGoTrueIdentityAdmin({ authUrl, adminKey: KEY, fetch, timeoutMs: 25 });
    await expect(admin.deleteUser(ID)).rejects.toMatchObject({
      name: "IdentityAdminError",
      code: "unavailable",
      message: "unavailable",
    });
  });

  it("never forwards the credential to a redirect destination", async () => {
    let forwarded = 0;
    const destination = await stub((_req, res) => {
      forwarded++;
      res.writeHead(200).end();
    });
    const authUrl = await stub((_req, res) => {
      res.writeHead(307, { location: destination }).end();
    });
    const admin = createGoTrueIdentityAdmin({ authUrl, adminKey: KEY, fetch });
    await expect(admin.deleteUser(ID)).rejects.toMatchObject({ code: "unavailable" });
    expect(forwarded).toBe(0);
  });

  it("does not preserve a thrown transport error or its cause", async () => {
    const authUrl = await stub((_req, res) => res.end());
    const brokenFetch: typeof fetch = async () => {
      throw new Error(`${KEY} ${authUrl} ${ID}`);
    };
    const admin = createGoTrueIdentityAdmin({ authUrl, adminKey: KEY, fetch: brokenFetch });
    const failure = await admin.deleteUser(ID).catch((error: unknown) => error);
    expect(failure).toMatchObject({
      name: "IdentityAdminError",
      code: "unavailable",
      message: "unavailable",
    });
    expect(failure).not.toHaveProperty("cause");
  });
});
