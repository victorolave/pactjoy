import { describe, expect, it } from "vitest";
import { type ApiEnvError, describeEnvError, loadApiEnv } from "../src/composition/config.ts";

const SECRET_URL = "postgres://u:secret@h:6543/db";
const S3_SECRET = "s3-secret-must-never-leak-0123456789";
const STORAGE = {
  API_STORAGE_S3_ENDPOINT: "http://kong:8000/storage/v1/s3",
  API_STORAGE_S3_REGION: "local",
  API_STORAGE_S3_ACCESS_KEY_ID: "s3-key-id-123",
  API_STORAGE_S3_SECRET_ACCESS_KEY: S3_SECRET,
  API_STORAGE_BUCKET: "entry-photos",
};
const BASE = { API_DATABASE_URL: SECRET_URL, SUPABASE_URL: "https://abc.supabase.co", ...STORAGE };

const load = (vars: Record<string, string | undefined>) => loadApiEnv((name) => vars[name]);

function failure(vars: Record<string, string | undefined>): ApiEnvError {
  const result = load(vars);
  if (result.ok) throw new Error("expected the environment to be rejected");
  return result.error;
}

describe("loadApiEnv", () => {
  it("builds the config from the minimal environment (AC-R3 inputs)", () => {
    const result = load(BASE);
    expect(result).toEqual({
      ok: true,
      value: {
        databaseUrl: SECRET_URL,
        supabaseUrl: "https://abc.supabase.co",
        jwksUrl: "https://abc.supabase.co/auth/v1/.well-known/jwks.json",
        jwtIssuer: "https://abc.supabase.co/auth/v1",
        allowedOrigins: [],
        storage: {
          endpoint: "http://kong:8000/storage/v1/s3",
          region: "local",
          accessKeyId: "s3-key-id-123",
          secretAccessKey: S3_SECRET,
          bucket: "entry-photos",
        },
        jobsSecret: null,
        push: null,
        authAdmin: null,
      },
    });
  });

  describe("identity administration (ADR-0019): optional, confined, never echoed", () => {
    const KEY = "admin-key-must-never-leak-0123456789";

    it("API_AUTH_ADMIN_KEY with the project URL builds the GoTrue admin target", () => {
      const result = load({ ...BASE, API_AUTH_ADMIN_KEY: KEY });
      expect(result.ok && result.value.authAdmin).toEqual({
        authUrl: "https://abc.supabase.co/auth/v1",
        key: KEY,
      });
      const local = load({ ...BASE, SUPABASE_URL: "http://kong:8000/", API_AUTH_ADMIN_KEY: KEY });
      expect(local.ok && local.value.authAdmin).toEqual({
        authUrl: "http://kong:8000/auth/v1",
        key: KEY,
      });
    });

    it("unset or blank leaves account deletion unconfigured (null), not a startup failure", () => {
      for (const unset of [undefined, "", "   "]) {
        const result = load({ ...BASE, API_AUTH_ADMIN_KEY: unset });
        expect(result.ok && result.value.authAdmin).toBeNull();
      }
    });

    it("a key that cannot be a credential is invalid by name, and its value is never in the error", () => {
      for (const bad of ["short", "has a space inside the key 0123456789"]) {
        const error = failure({ ...BASE, API_AUTH_ADMIN_KEY: bad });
        expect(error).toEqual({ missing: [], invalid: ["API_AUTH_ADMIN_KEY"] });
        expect(JSON.stringify(error)).not.toContain(bad);
        expect(describeEnvError(error)).not.toContain(bad);
      }
      expect(describeEnvError(failure({ ...BASE, API_AUTH_ADMIN_KEY: "short" }))).toContain(
        "API_AUTH_ADMIN_KEY",
      );
    });

    it("a JWT-shaped key (three base64url segments) is invalid by name: only the opaque secret key is accepted", () => {
      // Synthetic, built here; the shape of a legacy JWT credential.
      const jwtShaped = ["eyJhbGciOiJIUzI1NiJ9", "eyJyb2xlIjoieCJ9", "c2ln"].join(".");
      const error = failure({ ...BASE, API_AUTH_ADMIN_KEY: jwtShaped });
      expect(error).toEqual({ missing: [], invalid: ["API_AUTH_ADMIN_KEY"] });
      expect(JSON.stringify(error)).not.toContain(jwtShaped);
      expect(describeEnvError(error)).not.toContain(jwtShaped);
    });

    it("an unrelated failure never carries the key either", () => {
      const error = failure({ ...BASE, API_DATABASE_URL: undefined, API_AUTH_ADMIN_KEY: KEY });
      expect(JSON.stringify(error)).not.toContain(KEY);
      expect(describeEnvError(error)).not.toContain(KEY);
    });
  });

  describe("scheduled jobs and Web Push (ADR-0017): optional, validated, never echoed", () => {
    const JOBS_SECRET = `${"j".repeat(31)}!`;
    const PUSH = {
      API_PUSH_VAPID_PUBLIC_KEY: `B${"A".repeat(86)}`,
      API_PUSH_VAPID_PRIVATE_KEY: "k".repeat(43),
      API_PUSH_VAPID_SUBJECT: "mailto:ops@example.com",
    };

    it("reads the jobs secret and the VAPID group when set", () => {
      const result = load({ ...BASE, API_JOBS_SECRET: JOBS_SECRET, ...PUSH });
      expect(result.ok && result.value.jobsSecret).toBe(JOBS_SECRET);
      expect(result.ok && result.value.push).toEqual({
        publicKey: PUSH.API_PUSH_VAPID_PUBLIC_KEY,
        privateKey: PUSH.API_PUSH_VAPID_PRIVATE_KEY,
        subject: PUSH.API_PUSH_VAPID_SUBJECT,
      });
    });

    it("accepts an https subject", () => {
      const result = load({ ...BASE, ...PUSH, API_PUSH_VAPID_SUBJECT: "https://pactjoy.example" });
      expect(result.ok).toBe(true);
    });

    it("a jobs secret shorter than 32 characters is invalid, and its value is never in the error", () => {
      const error = failure({ ...BASE, API_JOBS_SECRET: "short-secret-hunter2" });
      expect(error).toEqual({ missing: [], invalid: ["API_JOBS_SECRET"] });
      expect(describeEnvError(error)).not.toContain("hunter2");
    });

    it("the VAPID variables come all together or not at all", () => {
      expect(
        failure({ ...BASE, API_PUSH_VAPID_PUBLIC_KEY: PUSH.API_PUSH_VAPID_PUBLIC_KEY }),
      ).toEqual({ missing: ["API_PUSH_VAPID_PRIVATE_KEY", "API_PUSH_VAPID_SUBJECT"], invalid: [] });
    });

    it.each([
      ["API_PUSH_VAPID_PUBLIC_KEY", "not-a-point"],
      ["API_PUSH_VAPID_PRIVATE_KEY", "has+slash/="],
      ["API_PUSH_VAPID_SUBJECT", "ops@example.com"],
    ])("%s of the wrong shape is invalid", (name, value) => {
      expect(failure({ ...BASE, ...PUSH, [name]: value })).toEqual({
        missing: [],
        invalid: [name],
      });
    });
  });

  it("AC-S5: a missing or empty API_DATABASE_URL names the variable and never a value", () => {
    for (const value of [undefined, "", "   "]) {
      const error = failure({ ...BASE, API_DATABASE_URL: value });
      expect(error).toEqual({ missing: ["API_DATABASE_URL"], invalid: [] });
      expect(describeEnvError(error)).toContain("API_DATABASE_URL");
    }
  });

  it("API_DATABASE_URL must be a postgres(ql) URL; the error names the variable, never the value", () => {
    for (const bad of [
      "postgres://user:p@ss:word@@@:notaport/db",
      "not a url with hunter2",
      "https://u:hunter2@h/db",
      "mysql://u:hunter2@h:3306/db",
    ]) {
      const error = failure({ ...BASE, API_DATABASE_URL: bad });
      expect(error).toEqual({ missing: [], invalid: ["API_DATABASE_URL"] });
      expect(JSON.stringify(error)).not.toContain("hunter2");
      expect(describeEnvError(error)).not.toMatch(/hunter2|p@ss/);
      expect(describeEnvError(error)).toContain("API_DATABASE_URL");
    }
    for (const good of ["postgres://u:secret@h:6543/db", "postgresql://u:secret@h/db"]) {
      expect(load({ ...BASE, API_DATABASE_URL: good }).ok).toBe(true);
    }
  });

  it("reports every missing required variable at once", () => {
    expect(failure({})).toEqual({
      missing: [
        "API_DATABASE_URL",
        "SUPABASE_URL",
        "API_STORAGE_S3_ENDPOINT",
        "API_STORAGE_S3_REGION",
        "API_STORAGE_S3_ACCESS_KEY_ID",
        "API_STORAGE_S3_SECRET_ACCESS_KEY",
        "API_STORAGE_BUCKET",
      ],
      invalid: [],
    });
  });

  it("SUPABASE_URL must be an http(s) URL; a trailing slash is tolerated", () => {
    for (const bad of ["not a url", "ftp://abc.supabase.co", "abc.supabase.co"]) {
      expect(failure({ ...BASE, SUPABASE_URL: bad })).toEqual({
        missing: [],
        invalid: ["SUPABASE_URL"],
      });
    }
    const ok = load({ ...BASE, SUPABASE_URL: "http://kong:8000/" });
    expect(ok.ok && ok.value.jwksUrl).toBe("http://kong:8000/auth/v1/.well-known/jwks.json");
    expect(ok.ok && ok.value.supabaseUrl).toBe("http://kong:8000");
  });

  it("SUPABASE_URL with a query or a fragment is invalid (the derived URLs would be wrong)", () => {
    for (const bad of ["https://abc.supabase.co?x=1", "https://abc.supabase.co/#frag"]) {
      expect(failure({ ...BASE, SUPABASE_URL: bad })).toEqual({
        missing: [],
        invalid: ["SUPABASE_URL"],
      });
    }
  });

  it("API_JWT_ISSUER override with a trailing slash is invalid (iss must match exactly)", () => {
    expect(
      failure({ ...BASE, API_JWT_ISSUER: "https://abc.supabase.co/auth/v1/" }).invalid,
    ).toEqual(["API_JWT_ISSUER"]);
  });

  it("API_JWT_ISSUER defaults to SUPABASE_URL/auth/v1 and can be overridden (local gateway)", () => {
    const local = load({
      ...BASE,
      API_DATABASE_URL: SECRET_URL,
      SUPABASE_URL: "http://kong:8000",
      API_JWT_ISSUER: "http://127.0.0.1:54321/auth/v1",
    });
    expect(local.ok && local.value.jwtIssuer).toBe("http://127.0.0.1:54321/auth/v1");
    expect(local.ok && local.value.jwksUrl).toBe("http://kong:8000/auth/v1/.well-known/jwks.json");
    const blank = load({ ...BASE, API_JWT_ISSUER: "" });
    expect(blank.ok && blank.value.jwtIssuer).toBe("https://abc.supabase.co/auth/v1");
    expect(failure({ ...BASE, API_JWT_ISSUER: "nope" }).invalid).toEqual(["API_JWT_ISSUER"]);
  });

  it("ALLOWED_ORIGINS: comma-separated exact origins, trimmed; unset or empty allows none", () => {
    for (const unset of [undefined, "", "  "]) {
      const result = load({ ...BASE, ALLOWED_ORIGINS: unset });
      expect(result.ok && result.value.allowedOrigins).toEqual([]);
    }
    const result = load({
      ...BASE,
      ALLOWED_ORIGINS: " https://app.pactjoy.com , http://localhost:5173 ",
    });
    expect(result.ok && result.value.allowedOrigins).toEqual([
      "https://app.pactjoy.com",
      "http://localhost:5173",
    ]);
  });

  it("ALLOWED_ORIGINS rejects wildcards, paths, trailing slashes, empty entries, 'null' and non-http", () => {
    for (const bad of [
      "*",
      "https://*.pactjoy.com",
      "https://app.pactjoy.com/",
      "https://app.pactjoy.com/path",
      "https://app.pactjoy.com,",
      "https://a.com,,https://b.com",
      "null",
      "ftp://app.pactjoy.com",
      "HTTPS://APP.PACTJOY.COM",
    ]) {
      expect([bad, failure({ ...BASE, ALLOWED_ORIGINS: bad }).invalid]).toEqual([
        bad,
        ["ALLOWED_ORIGINS"],
      ]);
    }
  });

  it("AC-S6: describeEnvError names variables and never leaks a value, even with a bad ALLOWED_ORIGINS", () => {
    const error = failure({
      ...BASE,
      ALLOWED_ORIGINS: "https://secret-origin.example/leaky-path",
    });
    const message = describeEnvError(error);
    expect(message).toContain("ALLOWED_ORIGINS");
    for (const leaked of ["secret", "leaky-path", SECRET_URL]) {
      expect(message).not.toContain(leaked);
    }
    const missing = describeEnvError(failure({ ...STORAGE, SUPABASE_URL: "bad-value-123" }));
    expect(missing).toContain("API_DATABASE_URL");
    expect(missing).toContain("SUPABASE_URL");
    expect(missing).not.toContain("bad-value-123");
  });

  it("reads each variable through the injected getter only", () => {
    const asked: string[] = [];
    loadApiEnv((name) => {
      asked.push(name);
      return undefined;
    });
    expect(asked.sort()).toEqual([
      "ALLOWED_ORIGINS",
      "API_AUTH_ADMIN_KEY",
      "API_DATABASE_URL",
      "API_JOBS_SECRET",
      "API_JWT_ISSUER",
      "API_PUSH_VAPID_PRIVATE_KEY",
      "API_PUSH_VAPID_PUBLIC_KEY",
      "API_PUSH_VAPID_SUBJECT",
      "API_STORAGE_BUCKET",
      "API_STORAGE_S3_ACCESS_KEY_ID",
      "API_STORAGE_S3_ENDPOINT",
      "API_STORAGE_S3_PUBLIC_ENDPOINT",
      "API_STORAGE_S3_PUBLIC_SIGNING_HOST",
      "API_STORAGE_S3_REGION",
      "API_STORAGE_S3_SECRET_ACCESS_KEY",
      "API_STORAGE_S3_SIGNING_HOST",
      "SUPABASE_URL",
    ]);
  });
});

describe("loadApiEnv: object storage (ADR-0016)", () => {
  const storageOf = (vars: Record<string, string | undefined>) => {
    const result = load({ ...BASE, ...vars });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    return result.value.storage;
  };

  it("each required storage variable is reported by name when missing or blank", () => {
    for (const name of Object.keys(STORAGE)) {
      for (const value of [undefined, "", "   "]) {
        expect(failure({ ...BASE, [name]: value })).toEqual({ missing: [name], invalid: [] });
      }
    }
  });

  it("the public endpoint and the two signing hosts are optional and, when set, part of the config", () => {
    expect(storageOf({}).publicEndpoint).toBeUndefined();
    expect(storageOf({}).signingHost).toBeUndefined();
    expect(storageOf({}).publicSigningHost).toBeUndefined();
    expect(
      storageOf({
        API_STORAGE_S3_PUBLIC_ENDPOINT: "https://t.trycloudflare.com/storage/v1/s3/",
        API_STORAGE_S3_SIGNING_HOST: "kong:54321",
        API_STORAGE_S3_PUBLIC_SIGNING_HOST: "t.trycloudflare.com:54321",
      }),
    ).toEqual({
      endpoint: "http://kong:8000/storage/v1/s3",
      publicEndpoint: "https://t.trycloudflare.com/storage/v1/s3",
      signingHost: "kong:54321",
      publicSigningHost: "t.trycloudflare.com:54321",
      region: "local",
      accessKeyId: "s3-key-id-123",
      secretAccessKey: S3_SECRET,
      bucket: "entry-photos",
    });
    // Blank counts as unset.
    expect(storageOf({ API_STORAGE_S3_PUBLIC_ENDPOINT: "  " }).publicEndpoint).toBeUndefined();
  });

  it("endpoints are http(s) base URLs, trailing slash tolerated, no query or fragment", () => {
    expect(storageOf({ API_STORAGE_S3_ENDPOINT: "https://s3.example/base/" }).endpoint).toBe(
      "https://s3.example/base",
    );
    for (const name of ["API_STORAGE_S3_ENDPOINT", "API_STORAGE_S3_PUBLIC_ENDPOINT"]) {
      for (const bad of [
        "not a url",
        "ftp://s3.example",
        "s3.example",
        "https://s3.example/?x=1",
      ]) {
        expect([name, bad, failure({ ...BASE, [name]: bad }).invalid]).toEqual([name, bad, [name]]);
      }
    }
  });

  it("signing hosts are host[:port], never a URL", () => {
    for (const name of ["API_STORAGE_S3_SIGNING_HOST", "API_STORAGE_S3_PUBLIC_SIGNING_HOST"]) {
      for (const good of ["kong:54321", "127.0.0.1:54321", "tunnel.example.com", "localhost"]) {
        expect(load({ ...BASE, [name]: good }).ok).toBe(true);
      }
      for (const bad of ["http://kong:54321", "kong:54321/path", "kong:", "kong:99999x", "a b"]) {
        expect([name, bad, failure({ ...BASE, [name]: bad }).invalid]).toEqual([name, bad, [name]]);
      }
    }
  });

  it("the bucket is a plain name: no slash, no space", () => {
    for (const bad of ["a/b", "has space", "../x"]) {
      expect(failure({ ...BASE, API_STORAGE_BUCKET: bad }).invalid).toEqual(["API_STORAGE_BUCKET"]);
    }
  });

  it("no storage value ever appears in an error message", () => {
    const error = failure({
      ...BASE,
      API_STORAGE_S3_ENDPOINT: "nope-secret-endpoint",
      API_STORAGE_BUCKET: "bad/secret-bucket",
      API_STORAGE_S3_SIGNING_HOST: "http://secret-host",
    });
    const message = describeEnvError(error);
    for (const leaked of [
      "secret-endpoint",
      "secret-bucket",
      "secret-host",
      S3_SECRET,
      "s3-key-id-123",
    ]) {
      expect(message).not.toContain(leaked);
      expect(JSON.stringify(error)).not.toContain(leaked);
    }
    expect(message).toContain("API_STORAGE_S3_ENDPOINT");
  });
});
