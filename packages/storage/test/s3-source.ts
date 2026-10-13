import { GenericContainer, Wait } from "testcontainers";
import { presign } from "../src/index.ts";

/**
 * SeaweedFS (S3 gateway) pinned by tag AND digest. It replaced MinIO: `minio/minio` on Docker Hub
 * and `quay.io/minio/minio` no longer serve anonymous pulls, which is all a GitHub Actions runner
 * has. `chrislusf/seaweedfs` pulls anonymously, validates SigV4 query presigns (including the
 * signed `content-length`, so a body of another size is a 403) and answers ranged GETs with 206:
 * what the contract needs. `TEST_S3_IMAGE` overrides the reference (a mirror, a newer tag).
 */
const S3_IMAGE =
  process.env.TEST_S3_IMAGE ??
  "chrislusf/seaweedfs:4.48@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d";
const S3_PORT = 8333;
const ACCESS_KEY_ID = "pactjoy-test-key";
const SECRET_ACCESS_KEY = "pactjoy-test-secret-0123456789";
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

/** A freshly started gateway answers connection errors and 5xx for a few seconds. */
async function createBucketWhenReady(source: Omit<S3Source, "stop">): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      return await createBucket(source);
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

/**
 * The S3 server for the integration tests: `TEST_S3_ENDPOINT` (+ `TEST_S3_ACCESS_KEY_ID`,
 * `TEST_S3_SECRET_ACCESS_KEY`, `TEST_S3_REGION`) when set, as in CI with a service container;
 * otherwise a SeaweedFS Testcontainer, like packages/db does for Postgres. Throws, never skips.
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
  const container = await new GenericContainer(S3_IMAGE)
    .withExposedPorts(S3_PORT)
    .withEnvironment({ AWS_ACCESS_KEY_ID: ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY: SECRET_ACCESS_KEY })
    .withCommand(["server", "-s3", "-dir=/data", "-volume.max=4", "-master.volumeSizeLimitMB=64"])
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
  const source = {
    endpoint: `http://${container.getHost()}:${container.getMappedPort(S3_PORT)}`,
    region: "us-east-1",
    bucket: BUCKET,
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
  };
  try {
    await createBucketWhenReady(source);
  } catch (error) {
    await container.stop();
    throw error;
  }
  return { ...source, stop: () => container.stop().then(() => {}) };
}
