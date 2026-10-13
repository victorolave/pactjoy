import { MinioContainer } from "@testcontainers/minio";
import { presign } from "../src/index.ts";

/**
 * MinIO pinned to the release the contract was verified on. `TEST_S3_IMAGE` overrides it: Docker Hub
 * no longer serves `minio/minio` for anonymous pulls, so a machine without the image cached
 * either points this at a mirror or sets `TEST_S3_ENDPOINT` (see below).
 */
const MINIO_IMAGE = process.env.TEST_S3_IMAGE ?? "minio/minio:RELEASE.2025-09-07T16-13-09Z";
const BUCKET = "entry-photos";

export interface S3Source {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  stop(): Promise<void>;
}

/** Creates the bucket with a presigned `PUT /bucket`, the same signer the adapter uses. */
async function createBucket(source: Omit<S3Source, "stop">): Promise<void> {
  const url = await presign({
    method: "PUT",
    url: `${source.endpoint}/${source.bucket}`,
    region: source.region,
    credentials: { accessKeyId: source.accessKeyId, secretAccessKey: source.secretAccessKey },
    now: Date.now(),
    expiresSeconds: 60,
  });
  const response = await fetch(url, { method: "PUT" });
  // 409 BucketAlreadyOwnedByYou: an external server reused between runs.
  if (!response.ok && response.status !== 409) {
    throw new Error(`could not create the test bucket (HTTP ${response.status})`);
  }
}

/**
 * The S3 server for the integration tests: `TEST_S3_ENDPOINT` (+ `TEST_S3_ACCESS_KEY_ID`,
 * `TEST_S3_SECRET_ACCESS_KEY`, `TEST_S3_REGION`) when set, as in CI with a service container;
 * otherwise a MinIO Testcontainer, like packages/db does for Postgres. Throws, never skips.
 */
export async function startS3Source(): Promise<S3Source> {
  const env = process.env;
  if (env.TEST_S3_ENDPOINT) {
    const source = {
      endpoint: env.TEST_S3_ENDPOINT.replace(/\/+$/, ""),
      region: env.TEST_S3_REGION ?? "us-east-1",
      bucket: BUCKET,
      accessKeyId: env.TEST_S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: env.TEST_S3_SECRET_ACCESS_KEY ?? "",
    };
    if (!source.accessKeyId || !source.secretAccessKey) {
      throw new Error("TEST_S3_ENDPOINT needs TEST_S3_ACCESS_KEY_ID and TEST_S3_SECRET_ACCESS_KEY");
    }
    await createBucket(source);
    return { ...source, stop: async () => {} };
  }
  const container = await new MinioContainer(MINIO_IMAGE).start();
  const source = {
    endpoint: container.getConnectionUrl().replace(/\/+$/, ""),
    region: "us-east-1",
    bucket: BUCKET,
    accessKeyId: container.getUsername(),
    secretAccessKey: container.getPassword(),
  };
  try {
    await createBucket(source);
  } catch (error) {
    await container.stop();
    throw error;
  }
  return { ...source, stop: () => container.stop().then(() => {}) };
}
