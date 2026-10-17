/**
 * The push payload the server sends (ADR-0017): `{v: 1, kind, params}`, ids only. Parsed without
 * trusting anything: a payload that is not exactly this shape is `null`, and the worker then shows
 * the generic notice.
 */
export interface PushPayload {
  readonly kind: string;
  readonly params: Readonly<Record<string, unknown>>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function parsePushPayload(text: string | null): PushPayload | null {
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.v !== 1 || typeof parsed.kind !== "string") return null;
  if (!isRecord(parsed.params)) return null;
  return { kind: parsed.kind, params: parsed.params };
}
