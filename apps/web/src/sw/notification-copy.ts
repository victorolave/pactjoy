import type { PushPayload } from "./push-payload.ts";

/**
 * The Spanish copy and destination of each push (ADR-0017). The payload carries ids only, so no
 * copy names a person; the screen it opens shows the details to whoever may see them. The one
 * exception is the reminder, which names the owner's own habit from names kept on the device.
 * Derived copy: the owner approves it at the real-iPhone check. Neutral on purpose: Notion forbids
 * pressure, rankings, streaks and "you did not log" (REQ-F1).
 */
export interface NotificationView {
  readonly title: string;
  readonly body: string;
  /** Collapses repeats of the same notice on the device. */
  readonly tag: string;
  /** A same-origin path to open on a tap. */
  readonly url: string;
}

export const GENERIC_NOTIFICATION: NotificationView = {
  title: "Tienes un aviso nuevo en PactJoy",
  body: "Ábrelo para verlo.",
  tag: "generic",
  url: "/",
};

/** An id as a single path segment: it can never add a slash, a dot segment or another origin. */
const segment = (value: string) => encodeURIComponent(value).replace(/\./g, "%2E");

type Builder = (
  params: Readonly<Record<string, string>>,
  names: ReadonlyMap<string, string>,
) => Omit<NotificationView, "tag">;

/** Per kind: the params it needs (all strings, or numbers turned into strings) and its view. */
const KINDS: Readonly<
  Record<string, { readonly needs: readonly string[]; readonly view: Builder }>
> = {
  pauseRequested: {
    needs: ["seasonId", "pauseRequestId"],
    // The approvals are answered inline in the Circle tab.
    view: () => ({
      title: "Hay una pausa por aprobar",
      body: "Alguien de tu círculo pidió una pausa.",
      url: "/circle",
    }),
  },
  pauseApproved: {
    needs: ["seasonId", "pauseRequestId"],
    view: () => ({ title: "Tu pausa está aprobada", body: "Puedes verla en Hoy.", url: "/" }),
  },
  pauseRejected: {
    needs: ["seasonId", "pauseRequestId"],
    view: () => ({ title: "Tu pausa no fue aprobada", body: "Puedes verla en Hoy.", url: "/" }),
  },
  pauseEndsTomorrow: {
    needs: ["seasonId", "pauseRequestId", "lastDate"],
    view: () => ({
      title: "Tu pausa termina mañana",
      // Sent the day BEFORE the last paused day (Today's "ends tomorrow"): tomorrow is still paused.
      body: "Mañana es el último día de tu pausa.",
      url: "/",
    }),
  },
  pactPendingApproval: {
    needs: ["seasonId", "pactRevision"],
    view: (p) => ({
      title: "Hay un pacto por revisar",
      body: "Tu círculo espera tu aprobación.",
      url: `/season/${segment(p.seasonId ?? "")}/pact`,
    }),
  },
  seasonStarted: {
    needs: ["seasonId"],
    view: () => ({
      title: "Empezó la temporada",
      body: "Tus compromisos cuentan desde hoy.",
      url: "/",
    }),
  },
  reviewDue: {
    needs: ["seasonId", "periodIndex"],
    view: (p) => ({
      title: "Tu revisión está lista",
      body: "Te toma un minuto.",
      url: `/review/${segment(p.seasonId ?? "")}/${segment(p.periodIndex ?? "")}`,
    }),
  },
  seasonClosed: {
    needs: ["seasonId"],
    // Today's season-close card leads to the closing review or the close flow, whichever is next.
    view: () => ({
      title: "Terminó la temporada",
      body: "Ya puedes ver cómo te fue.",
      url: "/",
    }),
  },
  encouragementNudge: {
    needs: ["seasonId", "encouragementId"],
    // To the recipient only (ADR-0018 F17). It never says why it was sent: the recipient must not
    // learn it followed a hard week. Who sent which emoji is in the Circle tab's activity.
    view: () => ({
      title: "Alguien te envió ánimo",
      body: "Míralo en la actividad de tu círculo.",
      url: "/circle",
    }),
  },
  commitmentReminder: {
    needs: ["seasonId", "commitmentId", "forDate"],
    // The owner's own habit by name only when the device knows it, which is only for a visible
    // commitment (`reminder-names.ts`); a private one stays generic on the lock screen. The tap
    // opens the Entry sheet on Today; a commitment no longer there just shows Today.
    view: (p, names) => {
      const name = names.get(p.commitmentId ?? "");
      return {
        title: name === undefined ? "Es hora de tu hábito" : `Es hora de ${name}`,
        body: "Toca para registrarlo.",
        url: `/?entry=${segment(p.commitmentId ?? "")}`,
      };
    },
  },
};

/** Params that are whole numbers; every other param is a non-empty string (an id or a date). */
const NUMERIC = new Set(["periodIndex", "pactRevision"]);
const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0;

const NO_NAMES: ReadonlyMap<string, string> = new Map();

/**
 * The view for a payload; the generic notice for anything unknown, incomplete or malformed.
 * `names` are the device's own habit names (`reminder-names.ts`), used by the reminder only.
 */
export function notificationFor(
  payload: PushPayload | null,
  names: ReadonlyMap<string, string> = NO_NAMES,
): NotificationView {
  if (payload === null) return GENERIC_NOTIFICATION;
  const kind = Object.hasOwn(KINDS, payload.kind) ? KINDS[payload.kind] : undefined;
  if (kind === undefined) return GENERIC_NOTIFICATION;
  const params: Record<string, string> = {};
  for (const name of kind.needs) {
    const value = payload.params[name];
    if (NUMERIC.has(name) ? typeof value === "number" && Number.isInteger(value) : isId(value)) {
      params[name] = String(value);
    } else {
      return GENERIC_NOTIFICATION;
    }
  }
  const subject = kind.needs.filter((name) => name !== "pactRevision").map((name) => params[name]);
  return { ...kind.view(params, names), tag: [payload.kind, ...subject].join(":") };
}
