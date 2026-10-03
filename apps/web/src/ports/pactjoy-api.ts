import type { TodayView } from "@pactjoy/app";

/** Everything the screens know about the backend. Adapters throw `ApiError`. */
export interface PactJoyApi {
  getToday(signal?: AbortSignal): Promise<TodayView>;
}
