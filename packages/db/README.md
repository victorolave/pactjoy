# @pactjoy/db

Postgres adapter for the ports of `@pactjoy/app` (ADR-0010). The only package that imports the database driver; its public API is `createPostgresUnitOfWork` in `src/index.ts`.

## Local dev seed (`pnpm seed:season`)

Realistic circles and seasons for testing the PWA on a real phone, against **local Supabase only**.

```sh
supabase start
export SEED_SERVICE_ROLE_KEY="$(supabase status -o env | sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"$/\1/p')"
pnpm seed:season                 # every scenario
pnpm seed:season --scenario pair # one scenario (also pair-season-ended, pair-season-stale, pair-pact-open, pair-pause)
```

How it works:

- **Real use cases, fake clock.** `scripts/dev-seed` runs the app's use cases (`createCircle`, `createSeason`, `approvePact`, `recordEntry`…) on this Postgres adapter with an injected clock. It sets the clock to a past local day, acts as the API would on that day, then moves forward day by day. There is no SQL for domain rows, so every rule (start-date window, grace, R1 counting, privacy) is the real one.
- **Local only.** It refuses to run unless the Supabase URL and the database URL are `127.0.0.1` or `localhost`. Defaults are the CLI's `http://127.0.0.1:54321` and `postgresql://postgres:postgres@127.0.0.1:54322/postgres`; override them with `SEED_SUPABASE_URL` and `SEED_DATABASE_URL`.
- **Accounts.** Each scenario has fixed `@pactjoy.local` accounts. The seed finds or creates them through the local GoTrue admin API, already confirmed, so no email is sent. The LOCAL service role key comes from `SEED_SERVICE_ROLE_KEY` or, if the CLI is installed, `supabase status -o env`. It stays in memory for the run and is never written. To log in on the phone, use the normal flow with the account's email; the 6-digit code arrives in Mailpit (http://127.0.0.1:54324).
- **Reruns.** Each run makes the scenario's accounts leave their current circle (the `leaveCircle` use case; the old circle stays as inactive history) and seeds again. Habits are reused by name, so Perfil does not fill with duplicates; a habit you graduated while testing is not reused, so a fresh one is created (the name may then also appear under "Hábitos graduados"). It never resets the database.
- **No photos.** The seed attaches none (`photoId: null` everywhere) and its use cases get a stub storage (`scripts/dev-seed/no-evidence-storage.ts`) that fails if it is ever called, so no object is uploaded. Take a photo from the app on the phone to try the flow.
- **Dates.** "Today" is the real day in `SEED_TIME_ZONE` (default: this machine's zone), which also becomes the season's zone.

| Scenario | Accounts | What it shows |
|---|---|---|
| `pair` | `andrea@pactjoy.local`, `victor@pactjoy.local` | Pair, week 3 of 8 (day 3). Week 1 good, week 2 difficult (under 50 %). Andrea: Leer (3/week, minutes), Meditar (every day, done, running streak, a "Hoy no salió", a late registro), Inglés (weekly total), Máximo 1 café al día (limit), a below-minimum session and a note. Victor: Gym (3/week), Dibujar (Tue/Thu/Sat) and a private Diario. |
| `pair-season-ended` | `andrea.cierre@pactjoy.local`, `victor.cierre@pactjoy.local` | Pair, 4-week season on day E+2 (day 30): results and closure open, nobody has closed, the closing review is pending for both. Weekly reviews done (Andrea's baseline, three interim reviews, the second with the full SRBAI; Victor skipped the baseline). Andrea: Leer `integrated` (screen 37 highlights "Graduar"), Meditar `developing`, Máximo 1 café al día `new`. Victor: Gym `developing`, Dibujar `new`, private Diario `integrated`. |
| `pair-season-stale` | `andrea.vencida@pactjoy.local`, `victor.vencida@pactjoy.local` | Same season on day E+8 (day 36): Andrea submitted her closing review and her closure, Victor did not, so the circle may move on without him. |
| `pair-pact-open` | `andrea.pacto@pactjoy.local`, `victor.pacto@pactjoy.local` | Circle "Andrea y Victor (pacto)": a 4-week season planned to start in 3 days, pact OPEN. Both filled their commitments (Andrea: Leer, Meditar, Inglés, Máximo 1 café al día; Victor: Gym, Dibujar, private Diario). Victor approved, Andrea did not: as Andrea you see "Aprobar el pacto" (12a) and can edit commitments (8-11); as Victor, "Esperando a Andrea" (12b). When Andrea approves, the pact-closed screen (14a) and the optional baseline offer (13) appear. |
| `pair-pause` | `andrea.pausa@pactjoy.local`, `victor.pausa@pactjoy.local` | Circle "Andrea y Victor (pausa)": week 3 of 8, day 3 of the week (season day 17, counting from 1). Andrea has two approved pauses: Inglés until tomorrow (Today notice 30a) and an open Meditar pause she can resume (29), with the "Los puntos se recalcularon" notice (30b, once per device). Victor asked today to pause Gym for a week and it is still pending: Andrea answers it in Círculo (28), Victor sees it pending (27). The 48 h auto-approval makes it approved if you wait; rerun to restore it. |
