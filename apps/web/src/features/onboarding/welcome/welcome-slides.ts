import type { IllustrationName } from "../../../ui/Placeholder.tsx";

export interface WelcomeSlide {
  readonly title: string;
  readonly body: string;
  /** What the picture shows, for screen readers. */
  readonly alt: string;
  /** An official illustration, when one fits; otherwise the neutral placeholder is drawn. */
  readonly illustration?: IllustrationName;
}

/**
 * Designs 1a-c. The design's pictures are not in the repository (and 1b, 1c are mock-ups of the
 * Today and season cards), so each slide keeps the neutral placeholder until the art is vendored.
 * The circle size says "de 1 a 6 personas": a solo circle is a valid one (OB-R7).
 */
export const WELCOME_SLIDES: readonly WelcomeSlide[] = [
  {
    title: "Elige una meta. Invita a alguien. Avancen a su manera.",
    body: "PactJoy es para círculos pequeños, de 1 a 6 personas: tu pareja, un amigo, tu hermana.",
    alt: "Dos personas con hábitos distintos, unidas por una cinta de color",
  },
  {
    title: "Metas distintas, la misma cuenta.",
    body: "Cada persona tiene 1.000 puntos posibles por temporada, repartidos entre sus compromisos. Así es justo aunque persigan cosas diferentes.",
    alt: "Las metas de dos personas, cada una con sus compromisos",
  },
  {
    title: "Compite contigo. Juega con otros.",
    body: "Cada compromiso tiene un mínimo para los días difíciles y un ideal. Lo que importa es volver, no ser perfecto.",
    alt: "Un compromiso con su mínimo y su ideal",
  },
];
