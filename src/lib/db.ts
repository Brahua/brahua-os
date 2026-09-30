import { attachDatabasePool } from "@vercel/functions";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as coreSchema from "@/modules/core/db/schema";

/** Every module's tables. Add each new module's schema here. */
export const schema = { ...coreSchema };

export type Database = NodePgDatabase<typeof schema> & { $client: Pool };

/** Builds a Drizzle client over a new `pg` Pool. Used by the app, scripts and tests. */
export function createDb(connectionString: string): Database {
  const pool = new Pool({ connectionString });
  // On Vercel Fluid Compute, keeps the instance alive until idle clients are released.
  // Outside Vercel it only registers a listener.
  attachDatabasePool(pool);
  return drizzle({ client: pool, schema });
}

let db: Database | undefined;

/**
 * Lazy, per-instance client over the pooled `DATABASE_URL`.
 * Created on first use so `next build` never needs a database.
 */
export function getDb(): Database {
  if (!db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    db = createDb(url);
  }
  return db;
}
