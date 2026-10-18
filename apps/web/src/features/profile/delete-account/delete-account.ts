/** The word the person types to confirm; the API checks the same one (ADR-0019). */
export const CONFIRMATION_WORD = "ELIMINAR";

/** Whether the typed text confirms the deletion: the word exactly (case included) around any whitespace. */
export function canConfirm(text: string): boolean {
  return text.trim() === CONFIRMATION_WORD;
}
