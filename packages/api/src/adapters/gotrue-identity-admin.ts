import { type IdentityAdmin, IdentityAdminError } from "@pactjoy/app";

export interface GoTrueIdentityAdminOptions {
  /** Supabase gateway URL including /auth/v1; never an end-user supplied URL. */
  readonly authUrl: string;
  /** Passed by the Edge composition root, never read from the environment here. */
  readonly adminKey: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/** GoTrue hard deletion. All external effects belong AFTER the data transaction (ADR-0019). */
export function createGoTrueIdentityAdmin(options: GoTrueIdentityAdminOptions): IdentityAdmin {
  const request = options.fetch ?? fetch;
  const base = options.authUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = {
    apikey: options.adminKey,
    "content-type": "application/json",
  };
  // The opaque secret key travels in `apikey` only; there is no bearer form of it (config rejects
  // a JWT-shaped key, so a legacy JWT credential can never reach this point).

  return {
    async deleteUser(userId) {
      let response: Response;
      try {
        response = await request(`${base}/admin/users/${encodeURIComponent(userId)}`, {
          method: "DELETE",
          headers,
          body: JSON.stringify({ should_soft_delete: false }),
          signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
          // A redirect must never forward an administrative credential, even to the same host.
          redirect: "error",
        });
      } catch {
        throw new IdentityAdminError("unavailable");
      }
      // Only a 404 body is ever inspected, and only to learn the user was already absent; it is
      // never propagated or logged. Every other body is released unread.
      const alreadyAbsent = response.status === 404 && (await isUserNotFound(response));
      await response.body?.cancel().catch(() => {});
      if (response.status === 200 || response.status === 204 || alreadyAbsent) return;
      throw new IdentityAdminError(
        response.status === 401 || response.status === 403 ? "rejected" : "unavailable",
      );
    },
  };
}

/** A GoTrue error body is tiny; anything past this is not one. */
const MAX_NOT_FOUND_BODY_BYTES = 4_096;

/**
 * A 404 means "already deleted" only when GoTrue says so: `error_code: "user_not_found"` or, on
 * older versions, a `msg` of "User not found". A wrong URL or a gateway route miss also answers 404
 * and must stay an error, or the auth user would silently survive.
 */
async function isUserNotFound(response: Response): Promise<boolean> {
  try {
    const reader = response.body?.getReader();
    if (!reader) return false;
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < MAX_NOT_FOUND_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const body: unknown = JSON.parse(
      new TextDecoder().decode(bytes.subarray(0, MAX_NOT_FOUND_BODY_BYTES)),
    );
    if (typeof body !== "object" || body === null) return false;
    const { error_code: code, msg } = body as { error_code?: unknown; msg?: unknown };
    return code === "user_not_found" || (typeof msg === "string" && /user not found/i.test(msg));
  } catch {
    return false;
  }
}
