/** The jobs, in the order a tick runs them (ADR-0017): settle before plan, plan before dispatch. */
export const JOBS = [
  "settle-due-pauses",
  "sweep-entry-photos",
  "plan-notifications",
  "dispatch-notifications",
] as const;

export type TickFetch = (
  url: string,
  init: { method: "POST"; headers: Record<string, string> },
) => Promise<{ status: number; text(): Promise<string> }>;

export interface TickOptions {
  /** The API base, e.g. `http://127.0.0.1:54321/functions/v1/api`. */
  readonly baseUrl: string;
  readonly secret: string;
  readonly fetch: TickFetch;
}

/**
 * One tick: POSTs every job in order and returns one line per job (`<job> <status> <data>`).
 * A failing job does not stop the others (each is independent and idempotent). The secret is
 * sent in the header only and never appears in a line.
 */
export async function runTick(options: TickOptions): Promise<readonly string[]> {
  const base = options.baseUrl.replace(/\/+$/, "");
  const lines: string[] = [];
  for (const job of JOBS) {
    try {
      const response = await options.fetch(`${base}/jobs/${job}`, {
        method: "POST",
        headers: { authorization: `Bearer ${options.secret}` },
      });
      const text = await response.text();
      let shown = text;
      try {
        const parsed = JSON.parse(text) as { data?: unknown; error?: { code?: string } };
        shown = JSON.stringify(parsed.data ?? parsed.error?.code ?? null);
      } catch {
        // Not JSON: shown as it came.
      }
      lines.push(`${job} ${response.status} ${shown.split(options.secret).join("***")}`);
    } catch (error) {
      lines.push(`${job} failed ${error instanceof Error ? error.name : "error"}`);
    }
  }
  return lines;
}
