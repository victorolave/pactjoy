import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.ts";

const valid = {
  VITE_SUPABASE_URL: "http://127.0.0.1:54321",
  VITE_SUPABASE_ANON_KEY: "anon-key",
  VITE_API_BASE_URL: "http://127.0.0.1:54321/functions/v1/api",
};

describe("loadConfig", () => {
  it("maps the three env vars to a typed config", () => {
    expect(loadConfig(valid)).toEqual({
      supabaseUrl: "http://127.0.0.1:54321",
      supabaseAnonKey: "anon-key",
      apiBaseUrl: "http://127.0.0.1:54321/functions/v1/api",
    });
  });

  it("strips trailing slashes from the URLs", () => {
    const config = loadConfig({
      ...valid,
      VITE_SUPABASE_URL: "http://127.0.0.1:54321/",
      VITE_API_BASE_URL: "http://127.0.0.1:54321/functions/v1/api//",
    });
    expect(config.supabaseUrl).toBe("http://127.0.0.1:54321");
    expect(config.apiBaseUrl).toBe("http://127.0.0.1:54321/functions/v1/api");
  });

  it("fails fast naming every missing variable", () => {
    const attempt = () => loadConfig({ VITE_SUPABASE_URL: valid.VITE_SUPABASE_URL });
    expect(attempt).toThrow(ConfigError);
    try {
      attempt();
    } catch (error) {
      expect((error as ConfigError).missing).toEqual([
        "VITE_SUPABASE_ANON_KEY",
        "VITE_API_BASE_URL",
      ]);
    }
  });

  it("treats blank values as missing", () => {
    expect(() => loadConfig({ ...valid, VITE_SUPABASE_ANON_KEY: "   " })).toThrow(ConfigError);
  });

  it("rejects a URL that is not absolute http(s)", () => {
    expect(() => loadConfig({ ...valid, VITE_API_BASE_URL: "/api" })).toThrow(ConfigError);
  });
});
