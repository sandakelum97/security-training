// Creates/updates the database schema (safe to run repeatedly).
import { readFileSync } from 'node:fs';
import { pool } from '../src/db.js';

await pool.query(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
console.log('Database schema is ready.');
await pool.end();
