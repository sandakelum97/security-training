import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { fileURLToPath } from 'node:url';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { config } from './config.js';
import { q } from './db.js';
import { modules, catalogEntry, publicQuestion } from './content.js';
import { hashPassword, verifyPassword, getDummyHash, passwordProblem, issueSession, clearSession, requireUser, requireAdmin } from './auth.js';

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'"], connectSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'none'"],
      formAction: ["'self'"], frameAncestors: ["'none'"], ...(config.isProd ? { upgradeInsecureRequests: [] } : {}),
    },
  },
  crossOriginEmbedderPolicy: false,
  strictTransportSecurity: config.isProd ? { maxAge: 63072000, includeSubDomains: true } : false,
}));
app.use((req, res, next) => { res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()'); next(); });

// ---------- API hardening ----------
const api = express.Router();
api.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
api.use(express.json({ limit: '10kb' }));
api.use(rateLimit({ windowMs: 15 * 60_000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false }));

// CSRF: SameSite=Strict cookie + every state change must carry a custom header (forces a CORS preflight
// that we never approve) and, when the browser sends one, a same-origin Origin header.
api.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  const self = `${req.protocol}://${req.get('host')}`;
  if (req.get('x-requested-with') !== 'fetch' || (origin && origin !== self && origin !== config.appOrigin)) {
    return res.status(403).json({ error: 'Request blocked.' });
  }
  next();
});

const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' } });

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const parse = (schema, data) => {
  const r = schema.safeParse(data);
  if (!r.success) { const e = new Error(r.error.issues[0]?.message || 'Invalid input.'); e.status = 400; e.safe = true; throw e; }
  return r.data;
};

const Email = z.email('Enter a valid email address.').max(254).transform(s => s.toLowerCase());
const Name = z.string().trim().min(2, 'Name is too short.').max(60)
  .regex(/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u, 'Use letters, spaces, apostrophes or hyphens only.');
const Uuid = z.uuid();

// ---------- Auth ----------
api.post('/auth/register', authLimiter, wrap(async (req, res) => {
  if (!config.allowRegistration) return res.status(403).json({ error: 'Registration is closed. Ask your administrator.' });
  const { name, email, password } = parse(z.object({ name: Name, email: Email, password: z.string().max(256) }), req.body);
  if (config.allowedEmailDomains.length && !config.allowedEmailDomains.includes(email.split('@')[1])) {
    return res.status(403).json({ error: 'Please use your organisation email address.' });
  }
  const problem = await passwordProblem(password, { email, name });
  if (problem) return res.status(400).json({ error: problem });
  const { rows } = await q(
    `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING RETURNING id, token_version`, [name, email, await hashPassword(password)]);
  if (!rows[0]) return res.status(409).json({ error: 'An account with this email already exists. Try signing in.' });
  await issueSession(res, rows[0]);
  res.status(201).json({ ok: true });
}));

api.post('/auth/login', authLimiter, wrap(async (req, res) => {
  const { email, password } = parse(z.object({ email: Email, password: z.string().min(1).max(256) }), req.body);
  const { rows } = await q('SELECT id, password_hash, token_version, locked_until FROM users WHERE email = $1', [email]);
  const user = rows[0];
  const ok = await verifyPassword(password, user?.password_hash ?? await getDummyHash());
  if (user && user.locked_until > new Date()) {
    return res.status(429).json({ error: 'Too many failed sign-ins. Try again in 15 minutes.' });
  }
  if (!user || !ok) {
    if (user) await q(`UPDATE users SET failed_logins = failed_logins + 1,
      locked_until = CASE WHEN failed_logins + 1 >= 10 THEN now() + interval '15 minutes' END WHERE id = $1`, [user.id]);
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  await q('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [user.id]);
  await issueSession(res, user);
  res.json({ ok: true });
}));

// Logging out revokes every session for this account (token_version bump).
api.post('/auth/logout', requireUser, wrap(async (req, res) => {
  await q('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [req.user.id]);
  clearSession(res);
  res.json({ ok: true });
}));

// ---------- Me ----------
api.get('/me', requireUser, (req, res) => {
  const { id, name, email, role, show_on_leaderboard } = req.user;
  res.json({ id, name, email, role, showOnLeaderboard: show_on_leaderboard, org: config.orgName });
});

api.patch('/me', requireUser, wrap(async (req, res) => {
  const { showOnLeaderboard } = parse(z.object({ showOnLeaderboard: z.boolean() }), req.body);
  await q('UPDATE users SET show_on_leaderboard = $1 WHERE id = $2', [showOnLeaderboard, req.user.id]);
  res.json({ ok: true });
}));

api.get('/me/attempts', requireUser, wrap(async (req, res) => {
  const { rows } = await q(`SELECT id, module_slug, score, total, passed, completed_at FROM attempts
    WHERE user_id = $1 AND completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 200`, [req.user.id]);
  res.json(rows.map(r => ({ ...r, title: modules.get(r.module_slug)?.title ?? r.module_slug })));
}));

// ---------- Modules & attempts ----------
api.get('/modules', (req, res) => res.json([...modules.values()].map(catalogEntry)));

function sample(arr, n) { // unbiased Fisher-Yates with a CSPRNG
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}

api.post('/modules/:slug/attempts', requireUser, wrap(async (req, res) => {
  const m = modules.get(req.params.slug);
  if (!m) return res.status(404).json({ error: 'Module not found.' });
  // Discard this user's unfinished attempts for the module so the table can't be flooded.
  await q('DELETE FROM attempts WHERE user_id = $1 AND module_slug = $2 AND completed_at IS NULL', [req.user.id, m.slug]);
  const picked = sample(m.questions, m.questionsPerAttempt);
  const { rows } = await q(`INSERT INTO attempts (user_id, module_slug, module_version, question_ids, total)
    VALUES ($1, $2, $3, $4, $5) RETURNING id`, [req.user.id, m.slug, m.version, picked.map(x => x.id), picked.length]);
  res.status(201).json({
    attemptId: rows[0].id, module: catalogEntry(m), lessons: m.lessons, sources: m.sources,
    questions: picked.map(publicQuestion),
  });
}));

// An attempt is only valid against the module version it started on. If content is updated mid-attempt,
// the learner must restart, so feedback and scores always match the questions they were shown.
const STALE = 'This module was just updated. Please start it again.';
const isCurrent = a => modules.get(a.module_slug)?.version === a.module_version;

// Each question can be answered exactly once; the reveal comes only after the answer is locked in.
api.post('/attempts/:id/answer', requireUser, wrap(async (req, res) => {
  const id = parse(Uuid, req.params.id);
  const { qid, choice } = parse(z.object({ qid: z.string().max(40), choice: z.number().int().min(0).max(9) }), req.body);
  const found = (await q('SELECT module_slug, module_version FROM attempts WHERE id = $1 AND user_id = $2', [id, req.user.id])).rows[0];
  if (found && !isCurrent(found)) return res.status(409).json({ error: STALE, stale: true });
  const { rows } = await q(`UPDATE attempts SET answers = answers || jsonb_build_object($3::text, $4::int)
    WHERE id = $1 AND user_id = $2 AND completed_at IS NULL AND started_at > now() - interval '3 hours'
      AND module_version = $5 AND $3 = ANY(question_ids) AND NOT (answers ? $3) RETURNING module_slug`,
    [id, req.user.id, qid, choice, found?.module_version ?? -1]);
  if (!rows[0]) return res.status(409).json({ error: 'This question was already answered or the attempt has expired.' });
  const question = modules.get(rows[0].module_slug).byId.get(qid);
  res.json({ correct: question?.answer === choice, answer: question?.answer, why: question?.why });
}));

api.post('/attempts/:id/finish', requireUser, wrap(async (req, res) => {
  const id = parse(Uuid, req.params.id);
  const { rows } = await q(`SELECT module_slug, module_version, question_ids, answers FROM attempts
    WHERE id = $1 AND user_id = $2 AND completed_at IS NULL`, [id, req.user.id]);
  const a = rows[0];
  if (!a) return res.status(404).json({ error: 'Attempt not found or already finished.' });
  if (!isCurrent(a)) {
    await q('DELETE FROM attempts WHERE id = $1 AND user_id = $2 AND completed_at IS NULL', [id, req.user.id]);
    return res.status(409).json({ error: STALE, stale: true });
  }
  const m = modules.get(a.module_slug);
  const score = a.question_ids.filter(qid => m.byId.get(qid)?.answer === a.answers[qid]).length;
  const passed = score / a.question_ids.length >= m.passMark;
  const upd = await q(`UPDATE attempts SET score = $3, passed = $4, completed_at = now()
    WHERE id = $1 AND user_id = $2 AND completed_at IS NULL RETURNING id`, [id, req.user.id, score, passed]);
  if (!upd.rows[0]) return res.status(409).json({ error: 'Attempt already finished.' });
  res.json({ score, total: a.question_ids.length, passed, certificateId: passed ? id : null });
}));

// ---------- Public: leaderboard & certificate verification ----------
const shortName = n => { const [first, ...rest] = n.trim().split(/\s+/); return rest.length ? `${first} ${rest.at(-1)[0]}.` : first; };

api.get('/leaderboard', wrap(async (req, res) => {
  const { rows } = await q(`WITH best AS (
      SELECT user_id, module_slug, max(score::float / total) AS s FROM attempts WHERE passed GROUP BY 1, 2)
    SELECT u.name, count(*)::int AS passed, round(avg(b.s) * 100)::int AS avg
    FROM best b JOIN users u ON u.id = b.user_id WHERE u.show_on_leaderboard
    GROUP BY u.id, u.name ORDER BY passed DESC, avg DESC, u.name LIMIT 20`);
  res.json(rows.map(r => ({ ...r, name: shortName(r.name) })));
}));

api.get('/certificates/:id', wrap(async (req, res) => {
  const id = Uuid.safeParse(req.params.id);
  if (!id.success) return res.status(404).json({ error: 'Certificate not found.' });
  const { rows } = await q(`SELECT u.name, a.module_slug, a.score, a.total, a.completed_at FROM attempts a
    JOIN users u ON u.id = a.user_id WHERE a.id = $1 AND a.passed`, [id.data]);
  if (!rows[0]) return res.status(404).json({ error: 'Certificate not found.' });
  const r = rows[0];
  res.json({ name: r.name, module: modules.get(r.module_slug)?.title ?? r.module_slug,
    score: r.score, total: r.total, completedAt: r.completed_at, org: config.orgName });
}));

// ---------- Admin ----------
const admin = express.Router();
admin.use(requireUser, requireAdmin);

admin.get('/users', wrap(async (req, res) => {
  const { search, page } = parse(z.object({ search: z.string().max(100).default(''), page: z.coerce.number().int().min(1).max(10000).default(1) }), req.query);
  const like = `%${search.replace(/[\\%_]/g, c => '\\' + c)}%`;
  const { rows } = await q(`SELECT u.id, u.name, u.email, u.role, u.created_at,
      (SELECT count(DISTINCT module_slug) FROM attempts a WHERE a.user_id = u.id AND a.passed)::int AS modules_passed,
      count(*) OVER ()::int AS total_count
    FROM users u WHERE u.name ILIKE $1 OR u.email ILIKE $1 ORDER BY u.created_at DESC LIMIT 50 OFFSET $2`, [like, (page - 1) * 50]);
  res.json({ total: rows[0]?.total_count ?? 0, users: rows.map(({ total_count, ...u }) => u) });
}));

admin.get('/users/:id/attempts', wrap(async (req, res) => {
  const { rows } = await q(`SELECT module_slug, score, total, passed, completed_at FROM attempts
    WHERE user_id = $1 AND completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 500`, [parse(Uuid, req.params.id)]);
  res.json(rows.map(r => ({ ...r, title: modules.get(r.module_slug)?.title ?? r.module_slug })));
}));

admin.get('/stats', wrap(async (req, res) => {
  const { rows } = await q(`SELECT module_slug, count(*)::int AS attempts, count(*) FILTER (WHERE passed)::int AS passes,
      count(DISTINCT user_id) FILTER (WHERE passed)::int AS learners_passed
    FROM attempts WHERE completed_at IS NOT NULL GROUP BY 1`);
  const users = await q('SELECT count(*)::int AS n FROM users');
  res.json({ users: users.rows[0].n, modules: rows.map(r => ({ ...r, title: modules.get(r.module_slug)?.title ?? r.module_slug })) });
}));

const notSelf = (req, res, id) => { if (id === req.user.id) { res.status(400).json({ error: 'You cannot change your own account here.' }); return false; } return true; };

admin.patch('/users/:id', wrap(async (req, res) => {
  const id = parse(Uuid, req.params.id);
  const { role } = parse(z.object({ role: z.enum(['user', 'admin']) }), req.body);
  if (!notSelf(req, res, id)) return;
  // Bump token_version so the change applies to any live session immediately.
  const { rowCount } = await q('UPDATE users SET role = $1, token_version = token_version + 1 WHERE id = $2', [role, id]);
  rowCount ? res.json({ ok: true }) : res.status(404).json({ error: 'User not found.' });
}));

admin.delete('/users/:id', wrap(async (req, res) => {
  const id = parse(Uuid, req.params.id);
  if (!notSelf(req, res, id)) return;
  const { rowCount } = await q('DELETE FROM users WHERE id = $1', [id]);
  rowCount ? res.json({ ok: true }) : res.status(404).json({ error: 'User not found.' });
}));

api.use('/admin', admin);
api.get('/health', (req, res) => res.json({ ok: true }));
api.use((req, res) => res.status(404).json({ error: 'Not found.' }));

// Never leak stack traces or SQL errors to clients.
api.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong. Please try again.' : err.safe ? err.message : 'Bad request.' });
});

app.use('/api', api);
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url)), { extensions: ['html'], maxAge: config.isProd ? '1h' : 0 }));
