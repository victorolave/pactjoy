/// <reference lib="webworker" />
/**
 * The service worker (WF-R7, ADR-0012, ADR-0017), built by vite-plugin-pwa's injectManifest.
 * It keeps what the generated worker did (precache the shell, offline navigation fallback, never
 * the API) and adds Web Push: every push shows a notification (iOS requires it), and a tap focuses
 * the app on the notice's same-origin path. The copy lives in `sw/notification-copy.ts`; the
 * payload carries ids only, and a reminder names its habit from the device's own names.
 */
import { clientsClaim } from "workbox-core";
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { notificationFor } from "./sw/notification-copy.ts";
import { type PushPayload, parsePushPayload } from "./sw/push-payload.ts";
import {
  decodeReminderNames,
  REMINDER_NAMES_CACHE,
  REMINDER_NAMES_KEY,
} from "./sw/reminder-names.ts";
import { NAVIGATE_FALLBACK, NAVIGATE_FALLBACK_DENYLIST } from "./sw/shell-config.ts";

declare const self: ServiceWorkerGlobalScope & {
  readonly __WB_MANIFEST: Parameters<typeof precacheAndRoute>[0];
};

// registerType "autoUpdate": a new worker takes over at once.
self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(
  new NavigationRoute(createHandlerBoundToURL(NAVIGATE_FALLBACK), {
    denylist: [...NAVIGATE_FALLBACK_DENYLIST],
  }),
);

/** The device's own habit names for reminders (`sw/reminder-names.ts`); none on any doubt. */
async function reminderNames(): Promise<ReadonlyMap<string, string>> {
  try {
    const cache = await self.caches.open(REMINDER_NAMES_CACHE);
    const stored = await cache.match(REMINDER_NAMES_KEY);
    return decodeReminderNames(stored ? await stored.text() : null);
  } catch {
    return decodeReminderNames(null);
  }
}

async function showNotice(payload: PushPayload | null): Promise<void> {
  const names = payload?.kind === "commitmentReminder" ? await reminderNames() : undefined;
  const notice = notificationFor(payload, names);
  await self.registration.showNotification(notice.title, {
    body: notice.body,
    tag: notice.tag,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: notice.url },
  });
}

self.addEventListener("push", (event) => {
  let text: string | null = null;
  try {
    text = event.data?.text() ?? null;
  } catch {
    text = null;
  }
  event.waitUntil(showNotice(parsePushPayload(text)));
});

/** Only a same-origin path is ever opened; anything else opens Today. */
function destinationOf(data: unknown): string {
  const url = (data as { url?: unknown } | null)?.url;
  if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//")) return "/";
  const resolved = new URL(url, self.location.origin);
  return resolved.origin === self.location.origin ? resolved.pathname + resolved.search : "/";
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = destinationOf(event.notification.data);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        const at = new URL(open.url);
        const here = at.pathname + at.search;
        // Already there: focusing is enough (navigating would reload the whole app).
        if (here === path) return;
        try {
          await open.navigate(path);
          return;
        } catch {
          // Some WebKit states refuse to navigate a client: open the destination instead.
        }
      }
      await self.clients.openWindow(path);
    })(),
  );
});
