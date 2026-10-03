import type { ConfigError } from "./config.ts";

/** Shown instead of the app when the build-time environment is incomplete (fail fast). */
export function ConfigErrorScreen({ error }: { readonly error: ConfigError }) {
  return (
    <main>
      <h1>Configuration error</h1>
      <p role="alert">
        {error.message}. Copy apps/web/.env.example to apps/web/.env.local and fill it in.
      </p>
    </main>
  );
}
