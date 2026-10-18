import {
  dispatchNotifications,
  planNotifications,
  settleDuePauses,
  sweepEntryPhotos,
} from "@pactjoy/app";
import type { JobCaller } from "../auth/jobs-guard.ts";
import type { PipelineRoute } from "../http/pipeline.ts";
import type { ApiResult } from "../http/types.ts";
import type { ApiDeps } from "./support.ts";

/** How many photo rows one sweep releases and purges, at most. */
const SWEEP_LIMIT = 100;

const counts = (data: object): ApiResult => ({ status: 200, data });

/**
 * The scheduled jobs (ADR-0017, REQ-J1): one POST per use case, run as the system (no actor), no
 * body, answering counts only. Each job is idempotent and bounded, so a trigger may call them as
 * often as it likes, in this order: settle, sweep, plan, dispatch.
 */
export function jobRoutes(deps: ApiDeps): PipelineRoute<JobCaller>[] {
  return [
    {
      method: "POST",
      pattern: "/settle-due-pauses",
      async handle() {
        const result = await settleDuePauses(deps, {});
        return counts(result.ok ? result.value : { settled: 0 });
      },
    },
    {
      method: "POST",
      pattern: "/sweep-entry-photos",
      async handle() {
        return counts(await sweepEntryPhotos(deps, { limit: SWEEP_LIMIT }));
      },
    },
    {
      method: "POST",
      pattern: "/plan-notifications",
      async handle() {
        const result = await planNotifications(deps, {});
        return counts(result.ok ? result.value : { enqueued: 0 });
      },
    },
    {
      method: "POST",
      pattern: "/dispatch-notifications",
      async handle() {
        const result = await dispatchNotifications(deps, {});
        return counts(result.ok ? result.value : {});
      },
    },
  ];
}
