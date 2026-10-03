/** `expiresAt` is epoch seconds, as GoTrue reports it. */
export interface Session {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly userId: string;
  readonly email: string | null;
}

/**
 * `InvalidSession`: the server definitively rejected the refresh token (the only code that ends a
 * session). `Network`, `RateLimited` and `Unknown` (5xx) are transient and keep it.
 */
export type AuthErrorCode =
  | "InvalidEmail"
  | "InvalidCode"
  | "InvalidSession"
  | "RateLimited"
  | "Network"
  | "Unknown";

export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode) {
    super(code);
    this.name = "AuthError";
    this.code = code;
  }
}

export interface AuthPort {
  /** Sends a one-time code to the email (creates the account when it does not exist). */
  requestCode(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<Session>;
  refresh(refreshToken: string): Promise<Session>;
  /** Best effort: resolves even when the server cannot be reached. */
  signOut(accessToken: string): Promise<void>;
}
