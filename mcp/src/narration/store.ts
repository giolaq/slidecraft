import { Pool } from "pg";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { emptyState, type State } from "./model.js";
export interface Store {
  transaction<T>(fn: (state: State) => T): Promise<T>;
  close(): Promise<void>;
}
// One row and an advisory lock keep account/job transitions atomic across instances.
// Audio is stored separately. This deliberately favors correctness over throughput.
export class PostgresStore implements Store {
  private pool: Pool;
  private ready: Promise<unknown>;
  constructor(url: string) {
    this.pool = new Pool({ connectionString: url, max: 5 });
    const pool = this.pool;
    this.ready = (async () => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT pg_advisory_xact_lock(73925181)");
        await c.query(
          "CREATE TABLE IF NOT EXISTS slidecraft_narration (id integer PRIMARY KEY, state jsonb NOT NULL)",
        );
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    })();
  }
  async transaction<T>(fn: (state: State) => T): Promise<T> {
    await this.ready;
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock(73925181)");
      const result = await c.query(
        "SELECT state FROM slidecraft_narration WHERE id=1",
      );
      const state: State = result.rows[0]?.state ?? emptyState();
      const value = fn(state);
      await c.query(
        "INSERT INTO slidecraft_narration VALUES (1,$1) ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state",
        [JSON.stringify(state)],
      );
      await c.query("COMMIT");
      return structuredClone(value);
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async close() {
    await this.pool.end();
  }
}
// Development only: serialized, atomic, persistent file, not suitable for replicas.
export class FileStore implements Store {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private path: string) {}
  transaction<T>(fn: (state: State) => T): Promise<T> {
    const result = this.tail.then(async () => {
      let state = emptyState();
      try {
        state = JSON.parse(await readFile(this.path, "utf8"));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      const value = fn(state);
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      await writeFile(this.path + ".tmp", JSON.stringify(state), {
        mode: 0o600,
      });
      await rename(this.path + ".tmp", this.path);
      return structuredClone(value);
    });
    this.tail = result.catch(() => {});
    return result;
  }
  async close() {
    await this.tail;
  }
}
