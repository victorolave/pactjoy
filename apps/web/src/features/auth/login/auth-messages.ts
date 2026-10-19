import { AuthError, type AuthErrorCode } from "../../../ports/auth.ts";

/** Placeholder Spanish copy (P8): the design has no wording for these failures yet. */
const MESSAGES: Record<AuthErrorCode, string> = {
  InvalidEmail: "Revisa tu correo: no parece válido.",
  InvalidCode: "El código no es válido o venció. Pide uno nuevo.",
  InvalidSession: "Tu sesión expiró. Entra de nuevo.",
  RateLimited: "Pediste muchos códigos. Espera un momento e inténtalo de nuevo.",
  Network: "No hay conexión. Revisa tu red e inténtalo de nuevo.",
  Unknown: "Algo salió mal. Inténtalo de nuevo.",
};

const isCode = (value: unknown): value is AuthErrorCode =>
  typeof value === "string" && Object.hasOwn(MESSAGES, value);

/** Accepts an AuthError, a bare code, or anything else (which gets the generic message). */
export function authMessage(failure: unknown): string {
  if (failure instanceof AuthError) return MESSAGES[failure.code];
  return isCode(failure) ? MESSAGES[failure] : MESSAGES.Unknown;
}
