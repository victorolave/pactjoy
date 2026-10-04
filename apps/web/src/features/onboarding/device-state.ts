import { useDeviceStore } from "../../context/device-store-context.tsx";

/** The longest displayName the API accepts, in code points (the app's `MAX_DISPLAY_NAME_LENGTH`). */
export const DISPLAY_NAME_MAX = 30;

/**
 * Why a displayName cannot be used, or `null` when it can. Counts code points like the API, so an
 * emoji is one character. The server stays the judge (uniqueness is checked there, per circle).
 */
export function displayNameProblem(raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0) return "Escribe tu nombre.";
  if ([...name].length > DISPLAY_NAME_MAX) {
    return `Tu nombre puede tener hasta ${DISPLAY_NAME_MAX} caracteres.`;
  }
  return null;
}

/**
 * The name typed in the name step, kept only on this device (no backend, no photo). It prefills the
 * editable displayName on create and join, and is the one onboarding value cleared on sign out.
 * Read straight from the store on every render, so a route change always sees the latest.
 */
export function useNameDraft(): {
  readonly draft: string | null;
  readonly saveDraft: (name: string) => void;
} {
  const device = useDeviceStore();
  return {
    draft: device.get("nameDraft"),
    saveDraft: (name) => device.set("nameDraft", name.trim()),
  };
}
