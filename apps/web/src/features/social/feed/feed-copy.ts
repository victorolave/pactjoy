import type { FeedItemDto, FeedMemberDto, FeedSubjectDto } from "../../../ports/wire.ts";
import { amountText } from "../../../shared/row-labels.ts";
import type { IconName } from "../../../ui/icon/Icon.tsx";
import { glyphOf } from "../reactions/reaction-emojis.ts";

/** One row of the feed, already in Spanish. Pure: the screens only lay it out. */
export interface FeedLine {
  readonly text: string;
  /** Whose avatar leads the row; `null` for a system row (it shows `icon`). */
  readonly avatarName: string | null;
  readonly icon: IconName | null;
}

const PRIVATE = "un objetivo privado";
const LEFT_MEMBER = "Un miembro que salió";

/** Short reason labels for "Gym · salud"; `other` names nothing (a bare "otro" says less than silence). */
const REASON: Readonly<Record<string, string>> = {
  health: "salud",
  travel: "viaje",
  work: "trabajo",
};

/** "Gym", "Gym y Leer", "Gym, Leer y 2 objetivos privados": the private ones collapse into one phrase. */
export function subjectsText(subjects: readonly FeedSubjectDto[]): string {
  const names = subjects.flatMap((subject) => (subject.kind === "habit" ? [subject.name] : []));
  const hidden = subjects.length - names.length;
  const parts = [
    ...names,
    ...(hidden === 0 ? [] : [hidden === 1 ? PRIVATE : `${hidden} objetivos privados`]),
  ];
  if (parts.length <= 1) return parts[0] ?? PRIVATE;
  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

type Actor =
  | { readonly kind: "you"; readonly avatar: string }
  | { readonly kind: "peer"; readonly name: string; readonly avatar: string }
  | { readonly kind: "left"; readonly name: string; readonly avatar: string };

function actorOf(memberId: string, members: readonly FeedMemberDto[]): Actor {
  const member = members.find((candidate) => candidate.id === memberId);
  // A member who left arrives without a name; the same goes for one the feed does not list.
  if (member === undefined || member.left || member.displayName === null) {
    return { kind: "left", name: LEFT_MEMBER, avatar: "?" };
  }
  if (member.isYou) return { kind: "you", avatar: member.displayName };
  return { kind: "peer", name: member.displayName, avatar: member.displayName };
}

/** "Completaste X." for the viewer, "Andrea completó X." for anyone else. */
const said = (actor: Actor, you: string, other: string, rest: string): string =>
  actor.kind === "you" ? `${you} ${rest}.` : `${actor.name} ${other} ${rest}.`;

function memberLine(item: FeedItemDto & { memberId: string }, members: readonly FeedMemberDto[]) {
  const actor = actorOf(item.memberId, members);
  const line = (text: string): FeedLine => ({ text, avatarName: actor.avatar, icon: null });
  switch (item.kind) {
    case "completed": {
      const subject = subjectsText([item.subject]);
      const what =
        item.value === null
          ? subject
          : `${subject} · ${amountText(item.value.amount, item.value.unit, item.value.customLabel)}`;
      return line(said(actor, "Completaste", "completó", what));
    }
    case "consistentWeek": {
      const subject = subjectsText([item.subject]);
      if (item.kept !== null && item.counted !== null) {
        const who = actor.kind === "you" ? "Tú" : actor.name;
        return line(`${who}: ${item.kept} de ${item.counted} en ${subject}.`);
      }
      return line(
        actor.kind === "you"
          ? `Tuviste una semana consistente en ${subject}.`
          : `${actor.name} tuvo una semana consistente en ${subject}.`,
      );
    }
    case "comeback":
      return line(actor.kind === "you" ? "Volviste." : `${actor.name} volvió.`);
    case "paused": {
      const reason = item.reason === null ? undefined : REASON[item.reason];
      const what = `${subjectsText(item.subjects)}${reason === undefined ? "" : ` · ${reason}`}`;
      return line(said(actor, "Pausaste", "pausó", what));
    }
    case "graduated":
      return line(said(actor, "Graduaste", "graduó", subjectsText([item.subject])));
    case "pointsRecalculated":
      return {
        text: `Los puntos se recalcularon por la pausa de ${subjectsText(item.subjects)}.`,
        avatarName: null,
        icon: "refresh-cw",
      } satisfies FeedLine;
    default:
      return null;
  }
}

/**
 * The Spanish line of one feed item, as the viewer sees it. The API already masked everything a
 * peer must not see (a private habit is `{kind: "private"}`), so this only words it. The tone is
 * the product's: it says what happened, never what did not.
 */
export function feedLine(item: FeedItemDto, members: readonly FeedMemberDto[]): FeedLine {
  switch (item.kind) {
    case "seasonStarted":
      return {
        text: `Empezó la temporada de ${item.lengthWeeks} semanas.`,
        avatarName: null,
        icon: "calendar-days",
      };
    case "seasonClosed":
      return { text: "La temporada terminó.", avatarName: null, icon: "circle-check" };
    case "encouragementReceived": {
      const sender = actorOf(item.senderId, members);
      const name = sender.kind === "you" ? "Tú" : sender.name;
      return {
        text: `${name} te envió ${glyphOf(item.emoji)}`,
        avatarName: sender.avatar,
        icon: null,
      };
    }
    default:
      return memberLine(item, members) ?? { text: "", avatarName: null, icon: null };
  }
}
