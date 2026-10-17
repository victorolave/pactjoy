import { describe, expect, it } from "vitest";
import { GENERIC_NOTIFICATION, notificationFor } from "./notification-copy.ts";
import { parsePushPayload } from "./push-payload.ts";

/**
 * What the service worker shows for each push (ADR-0017, REQ-K2..K4, REQ-W6): Spanish copy and a
 * same-origin destination from `{v, kind, params}` (ids only). Anything unexpected shows the
 * generic notice and opens `/`.
 */

const S = "season-1";
const P = "pause-1";
const payload = (kind: string, params: Record<string, unknown>) =>
  JSON.stringify({ v: 1, kind, params });
const show = (text: string | null) => notificationFor(parsePushPayload(text));

describe("notificationFor", () => {
  it.each([
    ["pauseRequested", { seasonId: S, pauseRequestId: P }, "Hay una pausa por aprobar", "/circle"],
    ["pauseApproved", { seasonId: S, pauseRequestId: P }, "Tu pausa está aprobada", "/"],
    ["pauseRejected", { seasonId: S, pauseRequestId: P }, "Tu pausa no fue aprobada", "/"],
    [
      "pauseEndsTomorrow",
      { seasonId: S, pauseRequestId: P, lastDate: "2026-10-20" },
      "Tu pausa termina mañana",
      "/",
    ],
    [
      "pactPendingApproval",
      { seasonId: S, pactRevision: 2 },
      "Hay un pacto por revisar",
      "/season/season-1/pact",
    ],
    ["seasonStarted", { seasonId: S }, "Empezó la temporada", "/"],
    ["reviewDue", { seasonId: S, periodIndex: 2 }, "Tu revisión está lista", "/review/season-1/2"],
    // Today's season-close card leads to the closing review or the close flow, whichever is next.
    ["seasonClosed", { seasonId: S }, "Terminó la temporada", "/"],
  ])("REQ-W6: %s shows %j and opens %s", (kind, params, title, url) => {
    const notice = show(payload(kind, params));
    expect(notice.title).toBe(title);
    expect(notice.url).toBe(url);
    expect(notice.body.length).toBeGreaterThan(0);
  });

  it("pauseEndsTomorrow says tomorrow is the LAST paused day (it fires the day before it, like Today)", () => {
    const notice = show(
      payload("pauseEndsTomorrow", { seasonId: S, pauseRequestId: P, lastDate: "2026-10-20" }),
    );
    expect(notice.body).toBe("Mañana es el último día de tu pausa.");
    expect(notice.body).not.toMatch(/retomas/);
  });

  it("tags a notice by kind and subject, so a repeat replaces it on the device", () => {
    expect(show(payload("reviewDue", { seasonId: S, periodIndex: 2 })).tag).toBe(
      "reviewDue:season-1:2",
    );
    expect(show(payload("seasonStarted", { seasonId: S })).tag).toBe("seasonStarted:season-1");
  });

  it.each([
    ["an unknown kind (SC-K5)", payload("overtaken", { seasonId: S })],
    ["missing params", payload("reviewDue", { seasonId: S })],
    ["a wrong version", JSON.stringify({ v: 2, kind: "seasonStarted", params: { seasonId: S } })],
    ["not JSON", "{oops"],
    ["no data", null],
    ["a non-string id", payload("seasonStarted", { seasonId: 42 })],
  ])("REQ-K2: %s shows the generic notice and opens /", (_name, text) => {
    expect(show(text)).toEqual(GENERIC_NOTIFICATION);
    expect(GENERIC_NOTIFICATION.url).toBe("/");
  });

  it("REQ-K3: an id can never turn the destination into another origin or path", () => {
    const notice = show(
      payload("pactPendingApproval", { seasonId: "//evil.example/x", pactRevision: 1 }),
    );
    expect(notice.url.startsWith("/season/")).toBe(true);
    expect(notice.url).not.toContain("//");
    expect(new URL(notice.url, "https://app.example").origin).toBe("https://app.example");
  });

  it("REQ-F1/K4: no copy talks about ranking, losing, streaks or not logging", () => {
    const kinds: [string, Record<string, unknown>][] = [
      ["pauseRequested", { seasonId: S, pauseRequestId: P }],
      ["pauseApproved", { seasonId: S, pauseRequestId: P }],
      ["pauseRejected", { seasonId: S, pauseRequestId: P }],
      ["pauseEndsTomorrow", { seasonId: S, pauseRequestId: P, lastDate: "2026-10-20" }],
      ["pactPendingApproval", { seasonId: S, pactRevision: 1 }],
      ["seasonStarted", { seasonId: S }],
      ["reviewDue", { seasonId: S, periodIndex: 1 }],
      ["seasonClosed", { seasonId: S }],
    ];
    for (const [kind, params] of kinds) {
      const { title, body } = show(payload(kind, params));
      expect(`${title} ${body}`).not.toMatch(/racha|posici|adelant|perdi|no registraste|ranking/i);
    }
  });
});
