/// <reference lib="webworker" />
/**
 * The service worker (WF-R7, ADR-0012, ADR-0017), built by vite-plugin-pwa's injectManifest.
 * It keeps what the generated worker did (precache the shell, offline navigation fallback, never
 * the API) and adds Web Push: every push shows a notification (iOS requires it), and a tap focuses
 * the app on the notice's same-origin path. The copy lives in `sw/notification-copy.ts`; the
 * payload carries ids only.
 */
import { clientsClaim } from "workbox-core";
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { notificationFor } from "./sw/notification-copy.ts";
import { parsePushPayload } from "./sw/push-payload.ts";
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

self.addEventListener("push", (event) => {
  let text: string | null = null;
  try {
    text = event.data?.text() ?? null;
  } catch {
    text = null;
  }
  const notice = notificationFor(parsePushPayload(text));
  event.waitUntil(
    self.registration.showNotification(notice.title, {
      body: notice.body,
      tag: notice.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: notice.url },
    }),
  );
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
        await open.navigate(path);
        return;
      }
      await self.clients.openWindow(path);
    })(),
  );
});
