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
  // Opaque gateway keys are not JWTs. Only JWT-shaped credentials can be bearer tokens.
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(options.adminKey)) {
    headers.Authorization = `Bearer ${options.adminKey}`;
  }

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
      // Never parse/log the upstream body; release it without allowing cleanup to change the result.
      await response.body?.cancel().catch(() => {});
      if (response.status === 200 || response.status === 204 || response.status === 404) return;
      throw new IdentityAdminError(
        response.status === 401 || response.status === 403 ? "rejected" : "unavailable",
      );
    },
  };
}
