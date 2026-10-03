/**
 * Local-only dev seed (WF-R8): a circle and an active 4 week season for a dev user, through the
 * public API only (no SQL, no service role key). Usage and requirements: apps/web/README.md.
 */
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { GoTrueAuth } from "../src/adapters/gotrue-auth.ts";
import { AuthError } from "../src/ports/auth.ts";

export interface SeedDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetch: typeof fetch;
  readonly readCode: () => Promise<string>;
  readonly log: (message: string) => void;
  readonly now: () => Date;
  readonly timeZone: string;
}

export function isLocalUrl(value: string): boolean {
  try {
    const { hostname } = new URL(value);
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
}

/** The only fields of the API's responses that the seed reads. */
interface Data {
  readonly id: string;
  readonly pactRevision: number;
}

interface Envelope {
  readonly data?: Data;
  readonly error?: { readonly code?: string };
}

class ApiFailure extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(`${code} (${status})`);
    this.code = code;
    this.status = status;
  }
}

const WEEK = [0, 1, 2, 3, 4, 5, 6];

/** Four commitments of 25% each, one per kind of measure the Today screen must render. */
const COMMITMENTS = [
  {
    name: "Meditar",
    measure: { unit: "done", frequency: { kind: "specificDays", weekdays: [1, 2, 3, 4, 5] } },
  },
  {
    name: "Leer",
    measure: {
      unit: "minutes",
      direction: "reach",
      minimum: "10",
      ideal: "30",
      schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
    },
  },
  {
    name: "Correr",
    measure: {
      unit: "km",
      direction: "reach",
      minimum: "10",
      ideal: "20",
      schedule: { period: "weeklyTotal" },
    },
  },
  {
    name: "Cafe",
    measure: {
      unit: "times",
      direction: "limit",
      ideal: "1",
      tolerance: "3",
      schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: WEEK } },
    },
  },
] as const;

const localDate = (date: Date, timeZone: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone }).format(date);

export async function runSeed(deps: SeedDeps): Promise<number> {
  const { env, log } = deps;
  const supabaseUrl = env.VITE_SUPABASE_URL ?? "";
  const anonKey = env.VITE_SUPABASE_ANON_KEY ?? "";
  const apiBaseUrl = env.VITE_API_BASE_URL ?? "";
  if (anonKey === "" || supabaseUrl === "" || apiBaseUrl === "") {
    log(
      "Missing VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY or VITE_API_BASE_URL (see .env.example).",
    );
    return 1;
  }
  if (!isLocalUrl(supabaseUrl) || !isLocalUrl(apiBaseUrl)) {
    log("Refusing to seed: both URLs must point to a local Supabase (127.0.0.1 or localhost).");
    return 1;
  }

  const email = env.SEED_EMAIL ?? "dev@pactjoy.local";
  const auth = new GoTrueAuth({
    baseUrl: supabaseUrl,
    anonKey,
    fetch: deps.fetch,
    clock: { nowMs: () => deps.now().getTime() },
  });

  try {
    await auth.requestCode(email);
    log(`Code sent to ${email}. Read it in Mailpit (http://127.0.0.1:54324).`);
    const session = await auth.verifyCode(email, await deps.readCode());

    const call = async (method: string, path: string, body: unknown): Promise<Data> => {
      const response = await deps.fetch(`${apiBaseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const parsed = (await response.json().catch(() => null)) as Envelope | null;
      if (!response.ok) throw new ApiFailure(parsed?.error?.code ?? "Unknown", response.status);
      return parsed?.data ?? { id: "", pactRevision: 0 };
    };

    const circle = await call("POST", "/circles", {
      name: "Los de siempre",
      displayName: "Victor",
    });
    const season = await call("POST", `/circles/${circle.id}/seasons`, {
      timezone: deps.timeZone,
      startDate: localDate(deps.now(), deps.timeZone),
      lengthWeeks: 4,
    });
    let pactRevision: number = season.pactRevision;
    for (const { name, measure } of COMMITMENTS) {
      const habit = await call("POST", "/habits", { name });
      const updated = await call("POST", `/seasons/${season.id}/commitments`, {
        habitId: habit.id,
        weightPercent: 25,
        privacy: "visible",
        measure,
      });
      pactRevision = updated.pactRevision;
    }
    // A single member closing the pact on its nominal start makes the season active today.
    await call("PUT", `/seasons/${season.id}/approval`, { expectedPactRevision: pactRevision });
    log(
      `Seeded circle "${circle.id}" with an active season. Open the app and sign in as ${email}.`,
    );
    return 0;
  } catch (error) {
    if (error instanceof ApiFailure && error.code === "AlreadyInActiveCircle") {
      log("This user already is in an active circle. To start clean, run `supabase db reset`.");
      return 0;
    }
    log(
      `Seed failed: ${error instanceof AuthError || error instanceof ApiFailure ? error.message : String(error)}`,
    );
    return 1;
  }
}

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const code = await runSeed({
    env: process.env,
    fetch,
    readCode: () => rl.question("Code: "),
    log: (message) => console.log(message),
    now: () => new Date(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  rl.close();
  process.exitCode = code;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
