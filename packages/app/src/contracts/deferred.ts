// The package compiles without DOM or Node typings; every runtime that runs
// the suites provides this timer.
declare function setTimeout(handler: () => void, ms: number): unknown;

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

/** Yields for `ms`, so a transaction that is free to run gets to. Never a verdict on correctness. */
export function delay(ms: number): Promise<void> {
  return new Promise((done) => {
    setTimeout(done, ms);
  });
}
