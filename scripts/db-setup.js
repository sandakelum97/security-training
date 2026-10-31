// Creates/updates the database schema (safe to run repeatedly).
// Neon recommends a direct (non-pooled) connection for migrations: DATABASE_URL_UNPOOLED is used when set.
import { readFileSync } from 'node:fs';
import { createPool } from '../src/db.js';

const pool = createPool(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
await pool.query(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
console.log('Database schema is ready.');
await pool.end();
