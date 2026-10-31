import pg from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import { config } from './config.js';

// node-postgres + a small pool, per Neon's guidance for Vercel (Node runtime / Fluid compute).
// Use the pooled connection string (host contains "-pooler") for DATABASE_URL.
export function createPool(connectionString = config.databaseUrl) {
  return new pg.Pool({
    connectionString,
    ssl: config.dbSsl ? { rejectUnauthorized: true } : false, // TLS is verified, never disabled silently
    max: Number(process.env.PG_POOL_MAX || 5),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 10_000,
  });
}

export const pool = createPool();
// On Vercel, lets idle connections close cleanly before a function instance is suspended.
if (process.env.VERCEL) attachDatabasePool(pool);

export const q = (text, params) => pool.query(text, params);
