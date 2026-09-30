// Better Auth tables (SPEC-core: "Tablas de Better Auth"), renamed with `modelName` to `auth_*`
// because `user` is a reserved word in Postgres.
// Property keys are the Better Auth field names (camelCase), which the Drizzle adapter looks up;
// columns are snake_case like the rest of the database. The adapter validates this shape at startup.
// The `auth_passkeys` table arrives with the passkey plugin (C2b).
import { bigint, boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const authUsers = pgTable("auth_users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  ...timestamps,
});

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (table) => [index("auth_sessions_user_id_idx").on(table.userId)],
);

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    /** Password hash (scrypt) for the `credential` provider. Never returned by the API. */
    password: text("password"),
    ...timestamps,
  },
  (table) => [index("auth_accounts_user_id_idx").on(table.userId)],
);

export const authVerifications = pgTable(
  "auth_verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [index("auth_verifications_identifier_idx").on(table.identifier)],
);

/** Rate limit counters (`rateLimit.storage: "database"`): memory does not survive serverless. */
export const authRateLimits = pgTable("auth_rate_limits", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

/** Drizzle adapter schema, keyed by the Better Auth `modelName` of each table. */
export const authSchema = {
  auth_users: authUsers,
  auth_sessions: authSessions,
  auth_accounts: authAccounts,
  auth_verifications: authVerifications,
  auth_rate_limits: authRateLimits,
};

export type AuthUser = typeof authUsers.$inferSelect;
