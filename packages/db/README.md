# @pactjoy/db

Postgres adapter for the ports of `@pactjoy/app` (ADR-0010). The only package that imports the database driver; its public API is `createPostgresUnitOfWork` in `src/index.ts`.

## Local dev seed (`pnpm seed:season`)

Realistic circles and seasons for testing the PWA on a real phone, against **local Supabase only**.

```sh
supabase start
export SEED_SERVICE_ROLE_KEY="$(supabase status -o env | sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"$/\1/p')"
pnpm seed:season                 # every scenario
pnpm seed:season --scenario pair # one scenario
```

How it works:

- **Real use cases, fake clock.** `scripts/dev-seed` runs the app's use cases (`createCircle`, `createSeason`, `approvePact`, `recordEntry`…) on this Postgres adapter with an injected clock. It sets the clock to a past local day, acts as the API would on that day, then moves forward day by day. There is no SQL for domain rows, so every rule (start-date window, grace, R1 counting, privacy) is the real one.
- **Local only.** It refuses to run unless the Supabase URL and the database URL are `127.0.0.1` or `localhost`. Defaults are the CLI's `http://127.0.0.1:54321` and `postgresql://postgres:postgres@127.0.0.1:54322/postgres`; override them with `SEED_SUPABASE_URL` and `SEED_DATABASE_URL`.
- **Accounts.** Each scenario has fixed `@pactjoy.local` accounts. The seed finds or creates them through the local GoTrue admin API, already confirmed, so no email is sent. The LOCAL service role key comes from `SEED_SERVICE_ROLE_KEY` or, if the CLI is installed, `supabase status -o env`. It stays in memory for the run and is never written. To log in on the phone, use the normal flow with the account's email; the 6-digit code arrives in Mailpit (http://127.0.0.1:54324).
- **Reruns.** Each run makes the scenario's accounts leave their current circle (the `leaveCircle` use case; the old circle stays as inactive history) and seeds again. Habits are reused by name, so Perfil does not fill with duplicates. It never resets the database.
- **Dates.** "Today" is the real day in `SEED_TIME_ZONE` (default: this machine's zone), which also becomes the season's zone.

| Scenario | Accounts | What it shows |
|---|---|---|
| `pair` | `andrea@pactjoy.local`, `victor@pactjoy.local` | Pair, week 3 of 8 (day 3). Week 1 good, week 2 difficult (under 50 %). Andrea: Leer (3/week, minutes), Meditar (every day, done, running streak, a "Hoy no salió", a late registro), Inglés (weekly total), Máximo 1 café al día (limit), a below-minimum session and a note. Victor: Gym (3/week), Dibujar (Tue/Thu/Sat) and a private Diario. |
