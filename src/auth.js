import { scrypt as _scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { SignJWT, jwtVerify } from 'jose';
import { config } from './config.js';
import { q } from './db.js';

const scrypt = promisify(_scrypt);
// OWASP Password Storage Cheat Sheet: N=2^15, r=8, p=3 is listed as equivalent to N=2^17/p=1 but uses
// 32 MiB instead of 128 MiB per hash, which matters on memory-limited serverless functions.
const N = 2 ** 15, R = 8, P = 3, KEYLEN = 32, MAXMEM = 64 * 1024 * 1024;
const COOKIE = config.isProd ? '__Host-session' : 'session';

export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scrypt(pw.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw, stored) {
  const [alg, n, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(pw.normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length,
    { N: +n, r: +r, p: +p, maxmem: Math.max(MAXMEM, 256 * +n * +r) }); // supports hashes made with older params
  return timingSafeEqual(key, expected);
}

// A real hash to compare against when the user doesn't exist, so response time doesn't reveal valid emails.
let dummyHash;
export const getDummyHash = async () => (dummyHash ??= await hashPassword(randomBytes(16).toString('hex')));

/** NIST SP 800-63B-4: >=15 chars for single-factor, no composition rules, check against blocklist/breaches. */
export async function passwordProblem(pw, { email, name }) {
  if (pw.length < 15) return 'Use at least 15 characters. A short phrase of random words works well.';
  if (pw.length > 128) return 'Use 128 characters or fewer.';
  const low = pw.toLowerCase();
  const local = email.split('@')[0];
  if (/^(.)\1+$/.test(pw)) return 'Avoid a single repeated character.';
  const personal = [local, ...name.toLowerCase().split(/\s+/)].filter(s => s.length >= 4);
  if (personal.some(s => low.includes(s))) {
    return 'Your password must not contain your name or email.';
  }
  if (config.hibpCheck && (await isPwned(pw))) {
    return 'This password has appeared in a known data breach. Please choose a different one.';
  }
  return null;
}

// Have I Been Pwned range API (k-anonymity): only the first 5 hex chars of the SHA-1 leave the server.
async function isPwned(pw) {
  const sha = createHash('sha1').update(pw).digest('hex').toUpperCase();
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${sha.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'open-security-awareness' },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return false;
    const suffix = sha.slice(5);
    return (await res.text()).split('\n').some(l => l.startsWith(suffix) && !l.endsWith(':0'));
  } catch { return false; } // fail open: availability of a third party must not block sign-up
}

export async function issueSession(res, user) {
  const token = await new SignJWT({ v: user.token_version })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id).setIssuedAt().setExpirationTime(`${config.sessionHours}h`)
    .sign(config.sessionKey);
  res.cookie(COOKIE, token, {
    httpOnly: true, secure: config.isProd, sameSite: 'strict', path: '/', maxAge: config.sessionHours * 3600_000,
  });
}

export const clearSession = res => res.clearCookie(COOKIE, { httpOnly: true, secure: config.isProd, sameSite: 'strict', path: '/' });

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** Loads the user on every request so role changes, deletion and logout take effect immediately. */
export async function requireUser(req, res, next) {
  const token = readCookie(req, COOKIE);
  if (!token) return res.status(401).json({ error: 'Please sign in.' });
  try {
    const { payload } = await jwtVerify(token, config.sessionKey, { algorithms: ['HS256'] });
    const { rows } = await q('SELECT id, name, email, role, token_version, show_on_leaderboard FROM users WHERE id = $1', [payload.sub]);
    const user = rows[0];
    if (!user || user.token_version !== payload.v) throw new Error('revoked');
    req.user = user;
    next();
  } catch {
    clearSession(res);
    res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }
}

export const requireAdmin = (req, res, next) =>
  req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only.' });
