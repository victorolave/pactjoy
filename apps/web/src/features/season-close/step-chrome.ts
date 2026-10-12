import type { ReactNode } from "react";
import type { IconName } from "../../ui/icon/Icon.tsx";

/** What every step of the flow shares: the top row of the full-screen frame (design 37). */
export interface StepChrome {
  readonly onBack: () => void;
  readonly backLabel: string;
  readonly backIcon: IconName;
  readonly progress: ReactNode;
}
