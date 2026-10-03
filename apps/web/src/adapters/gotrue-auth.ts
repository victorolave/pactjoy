import { AuthError, type AuthErrorCode, type AuthPort, type Session } from "../ports/auth.ts";
import type { Clock } from "../ports/clock.ts";

export interface GoTrueAuthOptions {
  readonly baseUrl: string;
  /** The anon or publishable key. Never the service role key. */
  readonly anonKey: string;
  readonly fetch: typeof fetch;
  readonly clock: Clock;
}

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const INVALID_CODE_ERRORS = new Set(["otp_expired", "otp_disabled", "invalid_credentials"]);

type Classifier = (status: number, body: Json | null) => AuthErrorCode;

const errorCodeIn = (body: Json | null): string =>
  typeof body?.error_code === "string" ? body.error_code : "";

/** GoTrue codes that mean the refresh token itself is dead (the only way a session ends). */
const REFRESH_REJECTED_CODES = new Set([
  "refresh_token_not_found",
  "refresh_token_already_used",
  "session_not_found",
]);
const REJECTION_STATUSES = new Set([400, 401, 403]);

/**
 * Refresh has its own table. A Kong 401 (wrong apikey, no GoTrue body) or a `bad_json` 400 is a
 * gateway or config fault, not a dead session, so it must stay transient (`Unknown`). The
 * sign-in codes (InvalidEmail, InvalidCode) never apply to a refresh.
 */
const classifyRefresh: Classifier = (status, body) => {
  const errorCode = errorCodeIn(body);
  if (status === 429 || errorCode.includes("rate_limit")) return "RateLimited";
  if (REJECTION_STATUSES.has(status) && REFRESH_REJECTED_CODES.has(errorCode)) {
    return "InvalidSession";
  }
  return "Unknown";
};

const classifySignIn =
  (onBadRequest: AuthErrorCode): Classifier =>
  (status, body) =>
    errorCodeOf(status, body, onBadRequest);

function errorCodeOf(
  status: number,
  body: Json | null,
  onBadRequest: AuthErrorCode,
): AuthErrorCode {
  const errorCode = errorCodeIn(body);
  if (status === 429 || errorCode.includes("rate_limit")) return "RateLimited";
  if (errorCode === "validation_failed" || errorCode === "email_address_invalid") {
    return "InvalidEmail";
  }
  if (INVALID_CODE_ERRORS.has(errorCode)) return "InvalidCode";
  if (status >= 400 && status < 500) return onBadRequest;
  return "Unknown";
}

/** GoTrue REST behind AuthPort: four fetch calls, no vendor SDK (ADR-0012). */
export class GoTrueAuth implements AuthPort {
  readonly #options: GoTrueAuthOptions;

  constructor(options: GoTrueAuthOptions) {
    this.#options = options;
  }

  async requestCode(email: string): Promise<void> {
    await this.#post("/otp", { email, create_user: true }, classifySignIn("Unknown"));
  }

  async verifyCode(email: string, code: string): Promise<Session> {
    const body = await this.#post(
      "/verify",
      { type: "email", email, token: code },
      classifySignIn("InvalidCode"),
    );
    return this.#toSession(body);
  }

  async refresh(refreshToken: string): Promise<Session> {
    const body = await this.#post(
      "/token?grant_type=refresh_token",
      { refresh_token: refreshToken },
      classifyRefresh,
    );
    return this.#toSession(body);
  }

  async signOut(accessToken: string): Promise<void> {
    try {
      // scope=local: end only this device (the default scope would sign out every device).
      await this.#send("/logout?scope=local", {}, accessToken);
    } catch {
      // Local sign out must always succeed; the server session expires on its own.
    }
  }

  async #post(path: string, payload: Json, classify: Classifier): Promise<Json> {
    const response = await this.#send(path, payload, null).catch(() => {
      throw new AuthError("Network");
    });
    const parsed: unknown = await response.json().catch(() => null);
    const body = isRecord(parsed) ? parsed : null;
    if (!response.ok) throw new AuthError(classify(response.status, body));
    return body ?? {};
  }

  #send(path: string, payload: Json, bearer: string | null): Promise<Response> {
    const headers = new Headers({
      apikey: this.#options.anonKey,
      "Content-Type": "application/json",
    });
    if (bearer !== null) headers.set("Authorization", `Bearer ${bearer}`);
    return this.#options.fetch(`${this.#options.baseUrl}/auth/v1${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  }

  #toSession(body: Json): Session {
    const user = isRecord(body.user) ? body.user : null;
    const { access_token: accessToken, refresh_token: refreshToken } = body;
    if (
      typeof accessToken !== "string" ||
      typeof refreshToken !== "string" ||
      typeof user?.id !== "string"
    ) {
      throw new AuthError("Unknown");
    }
    const expiresAt =
      typeof body.expires_at === "number"
        ? body.expires_at
        : Math.floor(this.#options.clock.nowMs() / 1000) +
          (typeof body.expires_in === "number" ? body.expires_in : 0);
    return {
      accessToken,
      refreshToken,
      expiresAt,
      userId: user.id,
      email: typeof user.email === "string" ? user.email : null,
    };
  }
}
