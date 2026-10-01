// Public surface of @pactjoy/api (ADR-0011). The router, schemas and presenters stay internal.
export { createJwksTokenVerifier } from "./adapters/jose-token-verifier.ts";
export type {
  TokenRejection,
  TokenVerifier,
  VerifiedToken,
} from "./auth/token-verifier.port.ts";
export {
  type ApiEnv,
  type ApiEnvError,
  describeEnvError,
  loadApiEnv,
} from "./composition/config.ts";
export { createLazyHandler } from "./composition/lazy-handler.ts";
export { createConsoleLogger, type Logger } from "./composition/logger.ts";
export type { Handler } from "./http/types.ts";
export { type ApiDeps, type ApiOptions, createApi } from "./routes/index.ts";
