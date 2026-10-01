/**
 * Logger port (type only here; the console adapter lands with the composition
 * slice). Callers must never pass tokens, bodies, notes, invite codes or user ids.
 */
export interface Logger {
  warn(event: string, fields?: Readonly<Record<string, unknown>>): void;
  error(event: string, fields?: Readonly<Record<string, unknown>>): void;
}
