// Password reset: one-time, 30-minute tokens. Only a SHA-256 hash is stored, so a database leak
// can't be used to reset accounts. Using a token revokes every session for that account.
import { randomBytes, createHash } from 'node:crypto';
import { config } from './config.js';
import { q, pool } from './db.js';
import { hashPassword, passwordProblem } from './auth.js';

const TTL_MINUTES = 30;
const sha256 = t => createHash('sha256').update(t).digest('hex');

export const emailEnabled = () => !!(config.resendApiKey && config.mailFrom && config.appOrigin);

/** Creates a new token for the user (replacing any older ones) and returns the raw token. */
export async function createResetToken(userId) {
  const token = randomBytes(32).toString('base64url');
  await q('DELETE FROM password_resets WHERE user_id = $1 OR expires_at < now()', [userId]);
  await q(`INSERT INTO password_resets (token_hash, user_id, expires_at)
    VALUES ($1, $2, now() + make_interval(mins => $3))`, [sha256(token), userId, TTL_MINUTES]);
  return token;
}

export const resetLink = (origin, token) => `${origin}/#/reset/${token}`;

/** Sends the reset email via Resend. Returns silently on failure so responses never reveal anything. */
export async function sendResetEmail(to, name, token) {
  const link = resetLink(config.appOrigin, token);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: config.mailFrom, to: [to], subject: `Reset your ${config.orgName} password`,
        text: `Hi ${name},\n\nSomeone asked to reset the password for this account. To choose a new password, open this link within ${TTL_MINUTES} minutes:\n\n${link}\n\nIf you didn't ask for this, you can ignore this email. Your password won't change.\n\n${config.orgName}`,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error('reset email failed:', res.status);
  } catch (err) { console.error('reset email failed:', err.name); }
}

/** Consumes a token and sets the new password. Returns an error message, or null on success. */
export async function consumeResetToken(token, password) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`DELETE FROM password_resets WHERE token_hash = $1 AND expires_at > now()
      RETURNING user_id`, [sha256(token)]);
    const userId = rows[0]?.user_id;
    if (!userId) { await client.query('ROLLBACK'); return 'This reset link is invalid or has expired. Ask for a new one.'; }
    const user = (await client.query('SELECT name, email FROM users WHERE id = $1', [userId])).rows[0];
    const problem = await passwordProblem(password, user);
    if (problem) { await client.query('ROLLBACK'); return problem; } // token stays valid so they can try again
    await client.query(`UPDATE users SET password_hash = $1, token_version = token_version + 1,
      failed_logins = 0, locked_until = NULL WHERE id = $2`, [await hashPassword(password), userId]);
    await client.query('DELETE FROM password_resets WHERE user_id = $1', [userId]);
    await client.query('COMMIT');
    return null;
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; }
  finally { client.release(); }
}
