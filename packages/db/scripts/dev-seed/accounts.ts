import type { Actor } from "@pactjoy/app";
import { userId } from "@pactjoy/app";

/** Gives the fixed local account for an email, creating it once (idempotent). */
export interface Accounts {
  ensure(email: string): Promise<Actor>;
}

interface AdminUser {
  readonly id: string;
  readonly email?: string;
}

/**
 * Local GoTrue admin API (`/auth/v1/admin/users`) with the LOCAL service role key: finds the
 * account by email or creates it already confirmed, so no email is sent (the OTP rate limit is
 * not involved). Logging in later is the normal OTP flow; its JWT `sub` is this same id, which
 * is the app's `userId`.
 */
export function goTrueAdminAccounts(options: {
  readonly supabaseUrl: string;
  readonly serviceRoleKey: string;
  readonly fetch: typeof fetch;
}): Accounts {
  const headers = {
    apikey: options.serviceRoleKey,
    authorization: `Bearer ${options.serviceRoleKey}`,
    "content-type": "application/json",
  };
  const admin = `${options.supabaseUrl}/auth/v1/admin/users`;
  return {
    async ensure(email) {
      const listed = await options.fetch(`${admin}?per_page=1000`, { headers });
      if (!listed.ok) throw new Error(`GoTrue admin list failed (${listed.status})`);
      const { users } = (await listed.json()) as { users: readonly AdminUser[] };
      const found = users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
      if (found) return { userId: userId(found.id) };
      const created = await options.fetch(admin, {
        method: "POST",
        headers,
        body: JSON.stringify({ email, email_confirm: true }),
      });
      if (!created.ok) throw new Error(`GoTrue admin create ${email} failed (${created.status})`);
      const user = (await created.json()) as AdminUser;
      return { userId: userId(user.id) };
    },
  };
}
