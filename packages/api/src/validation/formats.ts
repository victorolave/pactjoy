import { isInviteCodeFormat, type LocalDate, localDate } from "@pactjoy/app";
import { fail, type Schema, schema } from "./schema.ts";

/** Canonical lowercase, version-agnostic. Uppercase is rejected, never normalized (the app compares ids with `===`). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Upper bound on the raw invite code, so the app never normalizes an arbitrarily long string. */
const MAX_INVITE_INPUT_UNITS = 64;

export const uuid: Schema<string> = schema((v, path, sink) => {
  if (typeof v !== "string") return fail(sink, path, "type");
  return UUID.test(v) ? v : fail(sink, path, "format");
});

/** Format only; the RAW string is returned and the app normalizes it. */
export const inviteCode: Schema<string> = schema((v, path, sink) => {
  if (typeof v !== "string") return fail(sink, path, "type");
  return v.length <= MAX_INVITE_INPUT_UNITS && isInviteCodeFormat(v)
    ? v
    : fail(sink, path, "format");
});

export const forDate: Schema<LocalDate> = schema((v, path, sink) => {
  if (typeof v !== "string") return fail(sink, path, "type");
  try {
    return localDate(v);
  } catch {
    return fail(sink, path, "format");
  }
});

const NON_NEGATIVE_INT = /^(0|[1-9]\d*)$/;

export const weekIndexParam: Schema<number> = schema((v, path, sink) => {
  if (typeof v !== "string" && typeof v !== "number") return fail(sink, path, "type");
  const str = String(v);
  if (!NON_NEGATIVE_INT.test(str)) return fail(sink, path, "format");
  const num = Number(str);
  return Number.isSafeInteger(num) ? num : fail(sink, path, "range");
});
