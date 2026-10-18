import type { Actor } from "@pactjoy/app";
import { createAuthGuard } from "../auth/auth-guard.ts";
import { createJobsGuard, type JobCaller } from "../auth/jobs-guard.ts";
import { createThrownMapper } from "../errors/thrown.ts";
import { createPipeline, type PipelineOptions } from "../http/pipeline.ts";
import type { Handler } from "../http/types.ts";
import { circleRoutes } from "./circles.ts";
import { commitmentRoutes } from "./commitments.ts";
import { entryRoutes } from "./entries.ts";
import { habitRoutes } from "./habits.ts";
import { jobRoutes } from "./jobs.ts";
import { meRoutes } from "./me.ts";
import { pactRoutes } from "./pact.ts";
import { pauseRoutes } from "./pauses.ts";
import { photoRoutes } from "./photos.ts";
import { seasonProgressRoutes } from "./progress.ts";
import { commitmentProgressRoutes } from "./progress-commitments.ts";
import { memberProgressRoutes } from "./progress-members.ts";
import { weekSummaryRoutes } from "./progress-summary.ts";
import { pushRoutes } from "./push.ts";
import { reminderRoutes } from "./reminders.ts";
import { reviewRoutes } from "./reviews.ts";
import { scoreRoutes } from "./scores.ts";
import { scoringRoutes } from "./scoring.ts";
import { seasonCloseRoutes } from "./season-close.ts";
import { seasonRoutes } from "./seasons.ts";
import type { ApiDeps, Route } from "./support.ts";

export type { ApiDeps } from "./support.ts";
export type ApiOptions = PipelineOptions;

/** Route groups land slice by slice (C5b..C7c); the route table is the only place they are listed. */
const routeTable = (deps: ApiDeps): Route[] => [
  ...circleRoutes(deps),
  ...habitRoutes(deps),
  ...seasonRoutes(deps),
  ...commitmentRoutes(deps),
  ...pactRoutes(deps),
  ...pauseRoutes(deps),
  ...reviewRoutes(deps),
  ...reminderRoutes(deps),
  ...seasonCloseRoutes(deps),
  ...photoRoutes(deps),
  ...entryRoutes(deps),
  ...scoreRoutes(deps),
  ...seasonProgressRoutes(deps),
  ...memberProgressRoutes(deps),
  ...commitmentProgressRoutes(deps),
  ...weekSummaryRoutes(deps),
  ...scoringRoutes(),
  ...meRoutes(deps),
  ...pushRoutes(deps),
];

/**
 * The whole API as a Web `Request` handler, built from ports only. Two pipelines (ADR-0017, design
 * J9): the user routes behind the JWT guard, and, only when a jobs secret is configured, the job
 * routes under `<basePath>/jobs` behind the secret guard with no CORS. Each keeps its own caller
 * type, so a job handler can never see a user and the reverse.
 */
export function createApi(deps: ApiDeps, options: ApiOptions): Handler {
  const shared = {
    onError: createThrownMapper(deps.isUnavailable, deps.logger),
    logger: deps.logger,
    ...(deps.now ? { now: deps.now } : {}),
  };
  const users = createPipeline<Actor>({
    routes: routeTable(deps),
    authenticate: createAuthGuard({ verifier: deps.tokenVerifier, logger: deps.logger }),
    options,
    ...shared,
  });
  if (deps.jobsSecret === null) return users;

  const jobsBase = `${options.basePath}/jobs`;
  const jobs = createPipeline<JobCaller>({
    routes: jobRoutes(deps),
    authenticate: createJobsGuard(deps.jobsSecret),
    options: { ...options, basePath: jobsBase, allowedOrigins: [] },
    ...shared,
  });
  return (request) => {
    const path = new URL(request.url).pathname;
    return path === jobsBase || path.startsWith(`${jobsBase}/`) ? jobs(request) : users(request);
  };
}
