import { afterAll, beforeAll, beforeEach } from "vitest";
import { connect, databaseUrl, type Sql, truncateAll } from "./db.ts";

// Per-file setup of the `db` project (vitest `setupFiles`): every test starts from an empty
// store no matter which file ran before it, so isolation never depends on file order or on
// another file's cleanup. Registered before a file's own hooks, so those run on a clean store.
let sql: Sql;
beforeAll(() => {
  sql = connect(databaseUrl());
});
beforeEach(() => truncateAll(sql));
afterAll(() => sql.end());
