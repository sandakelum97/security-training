import pg from 'pg';
import { config } from './config.js';

// Small pool: serverless instances should hold few connections. Use your provider's pooled URL (e.g. Neon "-pooler").
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.dbSsl ? { rejectUnauthorized: true } : false, // TLS is verified, never disabled silently
  max: Number(process.env.PG_POOL_MAX || 5),
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 10_000,
});

export const q = (text, params) => pool.query(text, params);
