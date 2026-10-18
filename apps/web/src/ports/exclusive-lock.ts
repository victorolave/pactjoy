/**
 * Runs work while holding a named lock that every tab of this app respects, so two tabs never do
 * the same exclusive work at once (the outbox replay). Where the platform has no such lock, the
 * work simply runs.
 */
export interface ExclusiveLock {
  run<T>(name: string, work: () => Promise<T>): Promise<T>;
}
