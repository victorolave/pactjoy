// The package compiles without DOM or Node typings; every runtime that runs
// the suites provides these timers.
declare function setTimeout(handler: () => void, ms: number): unknown;
declare function clearTimeout(handle: unknown): void;

export interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

/** A gate a test opens by hand, to interleave transactions without timers. */
export function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * True when `promise` fulfils within `ms`. Only tells a blocked writer from
 * a free one, so a test can pick which branch to assert; it never decides
 * whether an outcome is correct.
 */
export async function fulfilledWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: unknown;
  const timeout = new Promise<boolean>((done) => {
    timer = setTimeout(() => done(false), ms);
  });
  try {
    return await Promise.race([
      promise.then(
        () => true,
        () => false,
      ),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
