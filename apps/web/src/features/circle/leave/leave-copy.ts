import type { MyCircle } from "../../../ports/pactjoy-api.ts";

type Circle = NonNullable<MyCircle["circle"]>;

export interface LeaveCopy {
  readonly title: string;
  readonly body: string;
}

/**
 * What leaving does depends on the season (design 40c only shows the mid-season case), so the
 * explanation varies with the phase and with how many people stay (WC-R12). It mirrors the
 * `leaveCircle` use case: while the pact is open the leaver's commitments are discarded and every
 * approval is reset; once it is locked nothing on the season changes; the last member archives it.
 */
export function leaveCopy(circle: Circle, season: MyCircle["season"]): LeaveCopy {
  const title = `¿Salir de ${circle.name}?`;
  const others = circle.members.filter((member) => !member.isYou);
  const phase = season?.phase ?? null;

  if (others.length === 0) {
    return {
      title,
      body:
        phase === "pactOpen"
          ? "Eres la única persona del círculo: al salir, el círculo se archiva y se descarta la temporada con el pacto abierto."
          : "Eres la única persona del círculo: al salir, el círculo se archiva.",
    };
  }
  switch (phase) {
    case "pactOpen":
      return {
        title,
        body: "El pacto sigue abierto: tus compromisos se descartarán y las aprobaciones de las demás personas volverán a empezar.",
      };
    case "notStarted":
      return {
        title,
        body: "La temporada todavía no empieza. Dejarás de formar parte del círculo; el pacto aprobado se conserva.",
      };
    case "active":
      return {
        title,
        body:
          others.length === 1
            ? `Saldrás de la clasificación de esta temporada. ${others[0]?.displayName} seguirá con sus métricas; como quedaría una sola persona en el círculo, la clasificación se ocultará.`
            : "Saldrás de la clasificación de esta temporada. Lo que registraste se conserva y la clasificación sigue para quienes se quedan.",
      };
    case "ended":
      return {
        title,
        body: "La temporada ya terminó. Dejarás de formar parte del círculo; lo que registraste en ella se conserva.",
      };
    case null:
      return {
        title,
        body: "Todavía no hay temporada. Dejarás de formar parte del círculo y podrás volver con un código de invitación.",
      };
  }
}
