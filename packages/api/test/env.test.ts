import { describe, expect, it } from "vitest";
import { type ApiEnvError, describeEnvError, loadApiEnv } from "../src/composition/config.ts";

const SECRET_URL = "postgres://u:secret@h:6543/db";
const BASE = { API_DATABASE_URL: SECRET_URL, SUPABASE_URL: "https://abc.supabase.co" };

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
      },
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
    expect(failure({})).toEqual({ missing: ["API_DATABASE_URL", "SUPABASE_URL"], invalid: [] });
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
      API_DATABASE_URL: SECRET_URL,
      SUPABASE_URL: "https://abc.supabase.co",
      ALLOWED_ORIGINS: "https://secret-origin.example/leaky-path",
    });
    const message = describeEnvError(error);
    expect(message).toContain("ALLOWED_ORIGINS");
    for (const leaked of ["secret", "leaky-path", SECRET_URL]) {
      expect(message).not.toContain(leaked);
    }
    const missing = describeEnvError(failure({ SUPABASE_URL: "bad-value-123" }));
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
      "API_DATABASE_URL",
      "API_JWT_ISSUER",
      "SUPABASE_URL",
    ]);
  });
});
