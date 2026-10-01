import type { EntryValueInput } from "@pactjoy/app";
import { literal, object, type Schema, string, tagged } from "./schema.ts";

/**
 * Structure only (RV-R4): `quantity.value` is a STRING so decimals stay exact (a JSON number is
 * a type issue, D10). Kind/commitment compatibility, range and decimals belong to the app.
 */
export const entryValue: Schema<EntryValueInput> = tagged<EntryValueInput>("kind", {
  done: object({ kind: literal("done") }),
  missed: object({ kind: literal("missed") }),
  quantity: object({ kind: literal("quantity"), value: string }),
});
