import { createContext, useContext } from "react";
import { NO_MARKS, type PendingMarks } from "../entry/index.ts";

/**
 * What is waiting on the phone, as `overlayToday` worked it out for the Today on screen. The rows
 * and the De ayer card read their own marks from here instead of threading them through every
 * layer.
 */
export const PendingMarksContext = createContext<PendingMarks>(NO_MARKS);

export const usePendingMarks = (): PendingMarks => useContext(PendingMarksContext);
