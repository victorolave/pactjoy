# @pactjoy/web

The PactJoy PWA: a Vite + React SPA that talks to the API through ports (ADR-0012). It never writes
to tables directly and never imports server code at runtime.

## Run it locally

1. Start Supabase: `supabase start` (from the repository root). If the CLI is not installed, run it
   as `npx --yes supabase@2.119.0 <command>` (here and below).
2. Let the API accept the dev origin. Copy `supabase/functions/.env.example` to
   `supabase/functions/.env` (it sets `ALLOWED_ORIGINS=http://localhost:5173`). The example file
   does not have `API_DATABASE_URL`, so add it too, or every API call answers 503
   (`composition.failed: missing API_DATABASE_URL`):
   `API_DATABASE_URL=postgresql://postgres:postgres@db:5432/postgres` (the local Supabase
   defaults). The host must be the alias `db`: underscore container hostnames fail DNS in Deno.
   Then serve the function with `supabase functions serve api --env-file supabase/functions/.env`.
3. Create `apps/web/.env.local` with `VITE_SUPABASE_URL=http://127.0.0.1:54321`,
   `VITE_API_BASE_URL=http://127.0.0.1:54321/functions/v1/api` and `VITE_SUPABASE_ANON_KEY` set to
   the anon or publishable key from `supabase status`. Never use the service role key here.
4. `pnpm --filter @pactjoy/web dev` serves the app at `http://localhost:5173` (the port is fixed
   because it must match the Supabase auth `site_url`).

### Test on an iPhone on the same Wi-Fi

1. Serve Vite on the network: `pnpm --filter @pactjoy/web dev --host 0.0.0.0`.
2. In `apps/web/.env.local`, point `VITE_SUPABASE_URL` and `VITE_API_BASE_URL` at the Mac's LAN IP
   instead of `127.0.0.1`.
3. Add `http://<LAN-IP>:5173` to `ALLOWED_ORIGINS` in `supabase/functions/.env` (comma separated)
   and restart the function.
4. Open `http://<LAN-IP>:5173` on the phone. Plain http is enough to test; installing the PWA
   needs https.

## Sign in and seed data

Sign-in uses a one-time email code. Locally, Supabase delivers it to Mailpit at
`http://127.0.0.1:54324` (the CLI default).

`pnpm --filter @pactjoy/web seed:dev` gives a dev user a circle and an active 4 week season through
the public API (no SQL, no service role key). It refuses to run unless both URLs point to
`127.0.0.1` or `localhost`. It asks for the code on stdin; use `SEED_EMAIL` to pick the user
(default `dev@pactjoy.local`). If the user already is in an active circle it exits 0 and suggests
`supabase db reset`.

## Source layout

```
src/
  features/<name>/   product features, grouped by capability (a user flow), never by file type
    index.ts         the feature's public API: the only file other code imports
    <capability>/    e.g. entry/one-tap, entry/edit, today/rows; tests sit next to the file they cover
  composition/       the composition root: dependencies, providers, query client
  context/           React contexts that carry a port (api, connectivity, haptics, ids) and the toast
  shell/             app chrome: routes, tab bar, error boundary, placeholder screens
  platform/          cross-cutting capabilities that are not features (offline)
  ports/ adapters/   interfaces owned by the client, and their browser or HTTP implementations
  shared/ ui/        pure helpers and presentational components
```

Dependencies run one way: `shell` and `composition` assemble features, `today` uses `entry`, `circle` uses `onboarding` and
`profile` uses `auth` and `circle` (the table in `test/architecture.test.ts`), and
features never import `composition` or `shell`. `test/architecture.test.ts` fails when a feature is
reached other than through its `index.ts`, when a feature imports another one that is not on that table, or when a feature imports
`composition` or `shell`.
