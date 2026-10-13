import { instant } from "@pactjoy/app";
import { createS3EvidenceStorage, presign } from "../src/index.ts";

/**
 * Manual smoke of the S3 adapter against a real Supabase Storage (ADR-0016). Runtime-neutral: the
 * Node entry point is `smoke-supabase.ts`; the same function runs inside the Edge Runtime to prove
 * the signed host from the Edge container. It prints HTTP statuses and verdicts only, never a URL,
 * a key or a signature.
 */
export interface SmokeConfig {
  /** Where this process reaches storage (server calls: HEAD, ranged GET, DELETE). */
  readonly endpoint: string;
  /** What the browser reaches (presigned PUT and GET); this process plays the browser against it. */
  readonly publicEndpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export interface SmokeRow {
  readonly step: string;
  readonly expected: string;
  readonly actual: string;
  readonly ok: boolean;
}

const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function hex32(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function body(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(JPEG_MAGIC, 0);
  for (let i = 3; i < size; i++) bytes[i] = (i * 31) % 251;
  return bytes;
}

export async function runSmoke(config: SmokeConfig): Promise<SmokeRow[]> {
  const rows: SmokeRow[] = [];
  const record = (step: string, expected: string, actual: string) =>
    rows.push({ step, expected, actual, ok: expected === actual });

  const storage = createS3EvidenceStorage({
    endpoint: config.endpoint,
    publicEndpoint: config.publicEndpoint,
    region: config.region,
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  });
  const now = () => instant(Date.now());
  const attempt = async (step: string, expected: string, run: () => Promise<string>) => {
    try {
      record(step, expected, await run());
    } catch (error) {
      const code = (error as { code?: string }).code;
      record(step, expected, `threw ${(error as Error).name}${code ? `:${code}` : ""}`);
    }
  };

  const key = `o/${hex32()}.jpg`;
  const bytes = body(2048);

  const signedPut = await storage.signUpload(
    key,
    { size: bytes.length, contentType: "image/jpeg" },
    120,
    now(),
  );
  await attempt("PUT presigned, exact size (browser host)", "200", async () => {
    const response = await fetch(signedPut.url, {
      method: "PUT",
      headers: { ...signedPut.headers },
      body: bytes as BodyInit,
    });
    return String(response.status);
  });

  await attempt("stat = HEAD (server host)", "2048 image/jpeg", async () => {
    const stat = await storage.stat(key);
    return stat ? `${stat.size} ${stat.contentType}` : "null";
  });

  await attempt("readHead = ranged GET, 3 bytes (server host)", "ff d8 ff", async () => {
    const head = await storage.readHead(key, 3);
    return head ? Array.from(head, (b) => b.toString(16).padStart(2, "0")).join(" ") : "null";
  });

  await attempt(
    "GET presigned download, bytes identical (browser host)",
    "200 identical",
    async () => {
      const urls = await storage.signDownloads([key], 120, now());
      const signed = urls.get(key);
      if (!signed) return "no url";
      const response = await fetch(signed.url);
      const got = new Uint8Array(await response.arrayBuffer());
      const same = got.length === bytes.length && got.every((b, i) => b === bytes[i]);
      return `${response.status} ${same ? "identical" : "different"}`;
    },
  );

  const wrongKey = `o/${hex32()}.jpg`;
  await attempt("PUT with a body of another size than signed (browser host)", "403", async () => {
    const signed = await storage.signUpload(
      wrongKey,
      { size: 1000, contentType: "image/jpeg" },
      120,
      now(),
    );
    const response = await fetch(signed.url, {
      method: "PUT",
      headers: { ...signed.headers },
      body: body(1001) as BodyInit,
    });
    return String(response.status);
  });

  const raw = async (rawKey: string, size: number, contentType: string) => {
    const url = await presign({
      method: "PUT",
      url: `${config.publicEndpoint.replace(/\/+$/, "")}/${config.bucket}/${rawKey}`,
      region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      now: Date.now(),
      expiresSeconds: 120,
      headers: { "content-length": String(size), "content-type": contentType },
    });
    const response = await fetch(url, {
      method: "PUT",
      headers: { "content-type": contentType },
      body: body(size) as BodyInit,
    });
    return String(response.status);
  };
  const bigKey = `o/${hex32()}.jpg`;
  await attempt("PUT 3 MiB + 1 byte, signed accordingly (bucket size limit)", "413", () =>
    raw(bigKey, 3 * 1024 * 1024 + 1, "image/jpeg"),
  );
  const textKey = `o/${hex32()}.jpg`;
  await attempt("PUT text/plain, signed accordingly (bucket mime limit)", "415", () =>
    raw(textKey, 100, "text/plain"),
  );

  await attempt("delete = presigned DELETE (server host)", "stat null", async () => {
    await storage.delete(key);
    return (await storage.stat(key)) === null ? "stat null" : "still there";
  });
  await attempt("delete again (idempotent)", "ok", async () => {
    await storage.delete(key);
    return "ok";
  });
  for (const stray of [wrongKey, bigKey, textKey]) await storage.delete(stray).catch(() => {});

  return rows;
}
