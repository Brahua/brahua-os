import { attachDatabasePool } from "@vercel/functions";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as coreSchema from "@/modules/core/db/schema";
import * as habitsSchema from "@/modules/habits/db/schema";
import * as projectsSchema from "@/modules/projects/db/schema";
import * as tasksSchema from "@/modules/tasks/db/schema";
import { poolConfig } from "./db-config";

/** Every module's tables. Add each new module's schema here. */
export const schema = { ...coreSchema, ...projectsSchema, ...tasksSchema, ...habitsSchema };

export type Database = NodePgDatabase<typeof schema> & { $client: Pool };

/** Builds a Drizzle client over a new `pg` Pool. Used by the app, scripts and tests. */
export function createDb(connectionString: string): Database {
  const pool = new Pool(poolConfig(connectionString));
  // On Vercel Fluid Compute, keeps the instance alive until idle clients are released.
  // Outside Vercel it only registers a listener.
  attachDatabasePool(pool);
  return drizzle({ client: pool, schema });
}

let cachedDb: Database | undefined;
// Outside production the client lives on globalThis so dev hot reloads do not leak pools.
const globalForDb = globalThis as typeof globalThis & { brahuaOsDb?: Database };

/**
 * Lazy client over the pooled `DATABASE_URL`, one per instance.
 * Created on first use so `next build` never needs a database.
 */
export function getDb(): Database {
  const cached = process.env.NODE_ENV === "production" ? cachedDb : globalForDb.brahuaOsDb;
  if (cached) return cached;

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const db = createDb(url);
  if (process.env.NODE_ENV === "production") cachedDb = db;
  else globalForDb.brahuaOsDb = db;
  return db;
}
