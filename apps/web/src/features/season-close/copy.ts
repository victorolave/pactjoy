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

/** What a failed call says (all DERIVED: the design has no error states for these screens). */
export const failureCopy = {
  notYet: (date: string) => `Tus resultados estarán listos el ${date}.`,
  notYetNoDate: "Tus resultados todavía no están listos.",
  /** SPEC: "la temporada ya se cerró". */
  closed: "La temporada ya se cerró.",
  nothing: "No tenías compromisos esta temporada, así que no hay nada que decidir.",
  reviewRequired: "Antes de decidir, haz tu revisión de cierre.",
  alreadySubmitted: "Ya habías guardado tus decisiones.",
  incomplete: "Falta alguna decisión. Revisa cada hábito.",
  notFound: "No encontramos esta temporada.",
  saveRetry: "No pudimos guardar tus decisiones. Revisa tu conexión.",
  loadRetry: "No pudimos cargar tus resultados. Revisa tu conexión.",
  generic: "Algo salió mal.",
} as const;

/** Screen 36 "Resultados" (DESIGN unless marked). */
export const resultsCopy = {
  /** DERIVED: the design's section header "Cierre de temporada" names the unavailable screens. */
  screenTitle: "Cierre de temporada",
  title: "Cerramos esta temporada",
  /** DESIGN "{n} semanas. Cada uno con sus metas."; the second sentence is dropped for a solo circle (DERIVED). */
  subtitle: (weeks: number, shared: boolean) =>
    shared ? `${weeks} semanas. Cada uno con sus metas.` : `${weeks} semanas.`,
  yourSeason: "Tu temporada",
  points: "Puntos",
  consistency: "Consistencia",
  ideal: "Ideal",
  automaticity: "Automaticidad",
  automaticityMeta: "inicio → cierre · 1–7",
  automaticityNote: "Privado. Solo tú ves estas cifras.",
  standings: "Clasificación final",
  decide: "Decidir qué sigue con cada hábito",
  /** DERIVED: the closing review is the gate of the decisions. */
  review: "Hacer la revisión de cierre",
  /** DERIVED: the member already closed; the screen is read-only. */
  seeDecisions: "Ver mis decisiones",
  /** DERIVED accessible names. */
  back: "Volver",
  statsLabel: "Tus cifras de la temporada",
  automaticityRow: (habit: string, journey: string) => `${habit}: ${journey}`,
} as const;

/** Screen 37 "Decisión por hábito" (DESIGN unless marked). */
export const decideCopy = {
  habitOf: (index: number, total: number) => `Hábito ${index} de ${total}`,
  /** DERIVED accessible name of the radio group. */
  group: "Qué hacer con este hábito",
  options: {
    continue: { label: "Continuar", hint: "Mismo compromiso en la próxima temporada." },
    adjust: {
      label: "Ajustar",
      hint: "Edita el compromiso de la próxima temporada, con los valores actuales.",
    },
    pause: { label: "Pausar", hint: "Dejarlo fuera de la próxima temporada." },
    graduate: { label: "Graduar 🎓", hint: "Ya forma parte de tu rutina. Dejas de registrarlo." },
  },
  next: "Continuar",
  /** DERIVED: the last habit sends everything; the design does not name that button. */
  save: "Guardar decisiones",
  saving: "Guardando",
  finalNote: "Después de guardar no podrás cambiar estas decisiones.",
} as const;

/** Screen 37b "Después del último hábito" (DESIGN unless marked). */
export const savedCopy = {
  title: "Decisiones guardadas.",
  body: "Si quieres, preparamos la siguiente temporada con los hábitos que vas a continuar o ajustar.",
  /** DERIVED: shown instead of the body while the circle cannot open the next season yet. */
  bodyWaiting: "Cuando todo tu círculo cierre, podrán preparar la siguiente temporada.",
  illustrationAlt: "Dos personas chocan las manos en alto",
  prepare: "Preparar la siguiente temporada",
  toToday: "Ir a Hoy",
  /** DERIVED: the design shows badges for graduate, continue and adjust; "Pausar" has none. */
  badges: {
    graduate: "🎓 Graduado",
    continue: "Continuar",
    adjust: "Ajustar",
    pause: "Queda fuera",
  },
  listLabel: "Tus decisiones",
} as const;

/** Screen 38a "Graduación: pregunta" (DESIGN unless marked). */
export const graduateCopy = {
  meta: (habit: string) => `Graduar ${habit}`,
  title: "¿Sientes que este hábito ya forma parte de tu rutina?",
  /**
   * DERIVED: the design says "...y podrás retomarlo en otra temporada", but graduation is permanent
   * (owner decision 3, ADR-0015: a graduated habit cannot be added again). The sentence is
   * replaced by the permanence; the owner decides if the design or the rule changes.
   */
  body: "Graduarlo significa dejar de registrarlo. Seguirá en tu perfil como hábito graduado. La decisión es definitiva.",
  illustrationAlt: "Un hombre camina tranquilo con un libro junto a una planta",
  confirm: "Sí, graduarlo",
  cancel: "Todavía no",
} as const;

/** Screen 38b "Graduación: celebración" (DESIGN unless marked). */
export const celebrationCopy = {
  title: (habit: string) => `Graduaste ${habit}`,
  /**
   * DERIVED: the design says the other member will see "{You} graduó {habit}" in the circle's
   * activity. There is no activity feed, and a graduation is private (ADR-0015, SC-G4), so the
   * line says the opposite.
   */
  note: "Solo tú ves esta decisión.",
  nextHabit: "Siguiente hábito",
  /** DERIVED: after the last graduated habit (the design note guesses "Continuar"). */
  onward: "Continuar",
} as const;
