import type { Connectivity } from "../ports/connectivity.ts";

/** `navigator.onLine` and the window's online/offline events. */
export class BrowserConnectivity implements Connectivity {
  isOnline(): boolean {
    return navigator.onLine;
  }

  subscribe(onChange: (online: boolean) => void): () => void {
    const online = () => onChange(true);
    const offline = () => onChange(false);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }
}
