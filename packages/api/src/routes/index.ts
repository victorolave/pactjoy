import type { Actor } from "@pactjoy/app";
import { createAuthGuard } from "../auth/auth-guard.ts";
import { createThrownMapper } from "../errors/thrown.ts";
import { createPipeline, type PipelineOptions } from "../http/pipeline.ts";
import type { Handler } from "../http/types.ts";
import { circleRoutes } from "./circles.ts";
import { commitmentRoutes } from "./commitments.ts";
import { entryRoutes } from "./entries.ts";
import { habitRoutes } from "./habits.ts";
import { pactRoutes } from "./pact.ts";
import { scoreRoutes } from "./scores.ts";
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
  ...entryRoutes(deps),
  ...scoreRoutes(deps),
];

/** The whole API as a Web `Request` handler, built from ports only. */
export function createApi(deps: ApiDeps, options: ApiOptions): Handler {
  return createPipeline<Actor>({
    routes: routeTable(deps),
    authenticate: createAuthGuard({ verifier: deps.tokenVerifier, logger: deps.logger }),
    options,
    onError: createThrownMapper(deps.isUnavailable),
  });
}
