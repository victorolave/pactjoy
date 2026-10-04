import { dayMonth, longDate } from "../../../shared/format.ts";

const DAY_MS = 86_400_000;

/** The calendar day an instant falls on in the device's time zone ("2026-10-08"). */
function localDate(instantIso: string): string {
  return new Date(instantIso).toLocaleDateString("en-CA");
}

/** An invite whose `expiresAt` is not after the device's now no longer works (WC-R2). */
export function isExpired(expiresAtIso: string, nowMs: number): boolean {
  return Date.parse(expiresAtIso) <= nowMs;
}

/** "Caduca en 7 días, el domingo 11 de octubre." The window is the server's; the wording is ours. */
export function expiryNote(expiresAtIso: string, nowMs: number): string {
  const days = Math.ceil((Date.parse(expiresAtIso) - nowMs) / DAY_MS);
  const date = longDate(localDate(expiresAtIso), false);
  if (days <= 1) return `Caduca en menos de un día, el ${date}.`;
  return `Caduca en ${days} días, el ${date}.`;
}

/** The short line of the waiting room: "Código · caduca el 11 de octubre". */
export function expiryLabel(expiresAtIso: string): string {
  return `Código · caduca el ${dayMonth(localDate(expiresAtIso))}`;
}

/** What "Compartir" hands to the other app (design 5). */
export function inviteMessage(code: string, expiresAtIso: string): string {
  return `Te invito a mi círculo en PactJoy. Código: ${code} (válido hasta el ${dayMonth(localDate(expiresAtIso))})`;
}
