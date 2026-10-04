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
 * Designs 1a-c. 1a and 1c use the design's own pictures. 1b is a mock-up of two season cards with
 * two avatars laid over them, not one picture, so it keeps the neutral placeholder.
 * The circle size says "de 1 a 6 personas": a solo circle is a valid one (OB-R7).
 */
export const WELCOME_SLIDES: readonly WelcomeSlide[] = [
  {
    title: "Elige una meta. Invita a alguien. Avancen a su manera.",
    body: "PactJoy es para círculos pequeños, de 1 a 6 personas: tu pareja, un amigo, tu hermana.",
    alt: "Una mujer se ata las zapatillas junto a la puerta y un hombre lee en el sofá, unidos por una cinta de color",
    illustration: "onboarding-1",
  },
  {
    title: "Metas distintas, la misma cuenta.",
    body: "Cada persona tiene 1.000 puntos posibles por temporada, repartidos entre sus compromisos. Así es justo aunque persigan cosas diferentes.",
    alt: "Las metas de dos personas, cada una con sus compromisos",
  },
  {
    title: "Compite contigo. Juega con otros.",
    body: "Cada compromiso tiene un mínimo para los días difíciles y un ideal. Lo que importa es volver, no ser perfecto.",
    alt: "Un hombre lee en un sillón con un café",
    illustration: "dia-dificil-crop",
  },
];
