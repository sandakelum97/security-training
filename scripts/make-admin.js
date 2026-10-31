// Promote an existing account to admin: npm run make-admin -- someone@example.org
import { pool } from '../src/db.js';

const email = (process.argv[2] || '').toLowerCase();
if (!email.includes('@')) { console.error('Usage: npm run make-admin -- <email>'); process.exit(1); }
const { rowCount } = await pool.query(
  "UPDATE users SET role = 'admin', token_version = token_version + 1 WHERE email = $1", [email]);
console.log(rowCount ? `${email} is now an admin (sign in again).` : `No account found for ${email}. Register first.`);
await pool.end();
