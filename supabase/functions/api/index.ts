// Supabase Edge Function entry (ADR-0011): the only Deno-aware code. Composition root only;
// routing, auth, validation and error mapping live in @pactjoy/api.
import {
  createApi,
  createConsoleLogger,
  createJwksTokenVerifier,
  createLazyHandler,
  describeEnvError,
  loadApiEnv,
} from "@pactjoy/api";
import {
  createCryptoRandomSource,
  createIntlTimeZone,
  createSystemClock,
  createUuidV7IdGenerator,
} from "@pactjoy/app";
import { createPostgresUnitOfWork, isDatabaseUnavailable } from "@pactjoy/db";

const logger = createConsoleLogger();

const build = () => {
  const loaded = loadApiEnv((name) => Deno.env.get(name));
  if (!loaded.ok) throw new Error(describeEnvError(loaded.error));
  const env = loaded.value;
  const clock = createSystemClock();
  return createApi(
    {
      uow: createPostgresUnitOfWork({ url: env.databaseUrl, max: 3, connectTimeoutSeconds: 5 }),
      clock,
      timeZone: createIntlTimeZone(),
      ids: createUuidV7IdGenerator({ clock }),
      random: createCryptoRandomSource(),
      tokenVerifier: createJwksTokenVerifier({ jwksUrl: env.jwksUrl, issuer: env.jwtIssuer }),
      logger,
      isUnavailable: isDatabaseUnavailable,
    },
    // Edge Functions prefix the URL path with the function name (confirmed locally by the S0 spike).
    { basePath: "/api", allowedOrigins: env.allowedOrigins },
  );
};

Deno.serve(createLazyHandler(build, { logger }));
