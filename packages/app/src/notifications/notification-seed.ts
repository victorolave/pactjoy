import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { OutboxNotice } from "./outbox-notice.ts";
import type { PushSubscriptionRecord } from "./push-subscription.repository.ts";

type App = { readonly uow: UnitOfWork<Repositories> };

/** Test setup: stores notices and devices straight to the stores (GIVEN state). */
export async function seedNotifications(
  app: App,
  rows: {
    readonly notices?: readonly OutboxNotice[];
    readonly devices?: readonly PushSubscriptionRecord[];
  },
): Promise<void> {
  await app.uow.transaction(async (repos) => {
    await repos.notifications.enqueue(rows.notices ?? []);
    for (const device of rows.devices ?? []) await repos.pushSubscriptions.upsert(device);
    return { ok: true as const, value: undefined };
  });
}
