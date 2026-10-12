/**
 * Every Spanish string of the season close (screens 36 to 38b and the Today card) lives in this
 * file, so the owner reviews the wording in one place. Three kinds, marked on each block:
 * - DESIGN: verbatim from the Claude Design batch 4 (screens 36, 37, 37b, 38a, 38b).
 * - SPEC: a string the specification fixes ("Esperando a tu círculo", "Resultados", "Pausar").
 * - DERIVED: not in the design; written in its tone (warm, short, no exclamation marks). Each is
 *   listed under "Derived copy" in the change's apply progress for the owner's review.
 */

/** Today card. */
export const todayCopy = {
  /** DERIVED: the review is done, the results day has not come (the design has no such card). */
  resultsSoonTitle: "Tus resultados llegan pronto.",
  resultsSoonBody: (date: string) => `Estarán listos el ${date}.`,
  /** DESIGN: the push "Cerramos esta temporada. Mira cómo te fue." split into title and line. */
  decideTitle: "Cerramos esta temporada.",
  decideBody: "Mira cómo te fue.",
  /** SPEC string "Resultados" as the verb phrase of the button (DERIVED wording). */
  decideAction: "Ver resultados",
  /** SPEC. */
  waitingTitle: "Esperando a tu círculo",
  /** DERIVED. */
  waitingBody: "Cuando todos cierren, podrán preparar la siguiente.",
  waitingOpenBody: "Tu círculo ya puede seguir con la siguiente.",
  /** DESIGN (37b primary button). */
  prepareNext: "Preparar la siguiente temporada",
} as const;
