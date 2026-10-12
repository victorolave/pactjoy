import type { ReactNode } from "react";
import type { IconName } from "../../ui/icon/Icon.tsx";

/** What every step of the flow shares: the top row of the full-screen frame (design 33 to 35). */
export interface StepChrome {
  /** The first screen closes the flow ("Cerrar"); every other one steps back ("Volver"). */
  readonly onBack: () => void;
  readonly backLabel: string;
  readonly backIcon: IconName;
  readonly progress: ReactNode;
}
