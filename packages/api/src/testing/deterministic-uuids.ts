import { createUuidV7IdGenerator, type IdGenerator, instant } from "@pactjoy/app";

/** Valid, unique, reproducible UUIDs (v7 layout, counter in the random bits). The app's sequential test ids are not uuids. */
export function createDeterministicUuidGenerator(): IdGenerator {
  let counter = 0;
  return createUuidV7IdGenerator({
    clock: { now: () => instant(0) },
    fill: (bytes) => {
      counter += 1;
      new DataView(bytes.buffer).setUint32(12, counter);
    },
  });
}
