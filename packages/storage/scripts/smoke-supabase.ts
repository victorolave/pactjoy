import { runSmoke } from "./smoke.ts";

/**
 * Manual smoke against local Supabase Storage (ADR-0016). Reads everything from the environment;
 * the S3 key pair comes from `supabase status -o env`:
 *
 *   eval "$(supabase status -o env | grep -E '^S3_PROTOCOL_|^STORAGE_S3_URL')"
 *   SMOKE_BUCKET=entry-photos pnpm --filter @pactjoy/storage smoke
 *
 * `SMOKE_ENDPOINT` (server calls) and `SMOKE_PUBLIC_ENDPOINT` (browser) default to `STORAGE_S3_URL`.
 * `SMOKE_SIGNING_HOST` / `SMOKE_PUBLIC_SIGNING_HOST` sign for another `host[:port]` than the one
 * connected to (local Supabase needs `<host>:54321`, see ADR-0016).
 * Prints statuses and verdicts only; exits 1 if any row is not as expected.
 */
const env = process.env;
const endpoint = env.SMOKE_ENDPOINT ?? env.STORAGE_S3_URL;
const accessKeyId = env.S3_PROTOCOL_ACCESS_KEY_ID;
const secretAccessKey = env.S3_PROTOCOL_ACCESS_KEY_SECRET;
if (!endpoint || !accessKeyId || !secretAccessKey) {
  console.error(
    "Set STORAGE_S3_URL (or SMOKE_ENDPOINT), S3_PROTOCOL_ACCESS_KEY_ID and S3_PROTOCOL_ACCESS_KEY_SECRET.",
  );
  process.exit(2);
}

const rows = await runSmoke({
  endpoint,
  publicEndpoint: env.SMOKE_PUBLIC_ENDPOINT ?? endpoint,
  ...(env.SMOKE_SIGNING_HOST ? { signingHost: env.SMOKE_SIGNING_HOST } : {}),
  ...(env.SMOKE_PUBLIC_SIGNING_HOST ? { publicSigningHost: env.SMOKE_PUBLIC_SIGNING_HOST } : {}),
  region: env.S3_PROTOCOL_REGION ?? "local",
  bucket: env.SMOKE_BUCKET ?? "entry-photos",
  accessKeyId,
  secretAccessKey,
});
for (const row of rows) {
  console.log(
    `${row.ok ? "PASS" : "FAIL"}  ${row.step}: expected ${row.expected}, got ${row.actual}`,
  );
}
process.exit(rows.every((row) => row.ok) ? 0 : 1);
