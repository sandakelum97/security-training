// Integration tests against a real Postgres (set DATABASE_URL, PGSSL=disable). Run: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET ||= 'test-secret-'.padEnd(40, 'x');
process.env.HIBP_CHECK = 'false';
const { app } = await import('../src/app.js');
const { pool } = await import('../src/db.js');
const { modules } = await import('../src/content.js');

let base, server;
before(async () => {
  server = app.listen(0); base = `http://127.0.0.1:${server.address().port}/api`;
  await pool.query("DELETE FROM users WHERE email LIKE '%@test.invalid'");
});
after(async () => { await pool.query("DELETE FROM users WHERE email LIKE '%@test.invalid'"); server.close(); await pool.end(); });

const call = async (path, { method = 'GET', body, cookie, headers = {} } = {}) => {
  const res = await fetch(base + path, { method, headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json', ...(cookie && { cookie }), ...headers },
    body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null), cookie: res.headers.get('set-cookie')?.split(';')[0], headers: res.headers };
};
const pw = 'correct horse battery staple';
const register = async (email, name = 'Test Learner') => (await call('/auth/register', { method: 'POST', body: { name, email, password: pw } })).cookie;

test('security headers are set', async () => {
  const r = await call('/modules');
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-powered-by'), null);
});

test('weak and personal passwords are rejected', async () => {
  for (const password of ['short', 'aaaaaaaaaaaaaaaaaa', 'learner-something-long']) {
    const r = await call('/auth/register', { method: 'POST', body: { name: 'Test Learner', email: 'weak@test.invalid', password } });
    assert.equal(r.status, 400, password);
  }
});

test('names containing markup are rejected', async () => {
  const r = await call('/auth/register', { method: 'POST', body: { name: '<img src=x onerror=alert(1)>', email: 'xss@test.invalid', password: pw } });
  assert.equal(r.status, 400);
});

test('CSRF: state changes without the custom header or from another origin are blocked', async () => {
  const noHeader = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(noHeader.status, 403);
  const evil = await call('/auth/login', { method: 'POST', body: {}, headers: { Origin: 'https://evil.example' } });
  assert.equal(evil.status, 403);
});

test('session cookie is HttpOnly + SameSite=Strict', async () => {
  const res = await fetch(base + '/auth/register', { method: 'POST', headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Cookie Check', email: 'cookie@test.invalid', password: pw }) });
  const c = res.headers.get('set-cookie');
  assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Strict/);
});

test('quiz never exposes answers; grading is server-side; answers lock; finish is single-use', async () => {
  const cookie = await register('quiz@test.invalid');
  const start = await call('/modules/phishing/attempts', { method: 'POST', cookie });
  assert.equal(start.status, 201);
  for (const q of start.body.questions) { assert.equal(q.answer, undefined); assert.equal(q.why, undefined); }
  const m = modules.get('phishing');
  const [first, ...rest] = start.body.questions;
  const a1 = await call(`/attempts/${start.body.attemptId}/answer`, { method: 'POST', cookie, body: { qid: first.id, choice: m.byId.get(first.id).answer } });
  assert.equal(a1.body.correct, true);
  const again = await call(`/attempts/${start.body.attemptId}/answer`, { method: 'POST', cookie, body: { qid: first.id, choice: 0 } });
  assert.equal(again.status, 409, 'cannot re-answer to fish for the correct option');
  for (const q of rest) await call(`/attempts/${start.body.attemptId}/answer`, { method: 'POST', cookie, body: { qid: q.id, choice: m.byId.get(q.id).answer } });
  const fin = await call(`/attempts/${start.body.attemptId}/finish`, { method: 'POST', cookie, body: { score: 999 } });
  assert.deepEqual([fin.body.score, fin.body.passed], [start.body.questions.length, true]);
  assert.equal((await call(`/attempts/${start.body.attemptId}/finish`, { method: 'POST', cookie })).status, 404);
  const cert = await call(`/certificates/${fin.body.certificateId}`);
  assert.equal(cert.status, 200); assert.equal(cert.body.module, m.title);
});

test('users cannot touch other users\' attempts or admin routes', async () => {
  const a = await register('owner@test.invalid');
  const b = await register('intruder@test.invalid');
  const start = await call('/modules/passwords-mfa/attempts', { method: 'POST', cookie: a });
  const q = start.body.questions[0];
  assert.equal((await call(`/attempts/${start.body.attemptId}/answer`, { method: 'POST', cookie: b, body: { qid: q.id, choice: 0 } })).status, 409);
  assert.equal((await call('/admin/users', { cookie: b })).status, 403);
  assert.equal((await call('/me')).status, 401);
});

test('logout revokes the session token', async () => {
  const c = await register('logout@test.invalid');
  assert.equal((await call('/me', { cookie: c })).status, 200);
  await call('/auth/logout', { method: 'POST', cookie: c });
  assert.equal((await call('/me', { cookie: c })).status, 401);
});

test('admin can promote, cannot modify self; role change revokes target sessions', async () => {
  const adminCookie = await register('admin@test.invalid', 'Admin Person');
  await pool.query("UPDATE users SET role = 'admin' WHERE email = 'admin@test.invalid'");
  const userCookie = await register('member@test.invalid', 'Member Person');
  const { body } = await call('/admin/users?search=member@test.invalid', { cookie: adminCookie });
  const target = body.users[0];
  assert.equal((await call(`/admin/users/${target.id}`, { method: 'PATCH', cookie: adminCookie, body: { role: 'admin' } })).status, 200);
  assert.equal((await call('/me', { cookie: userCookie })).status, 401, 'old session revoked after role change');
  const me = (await call('/me', { cookie: adminCookie })).body;
  assert.equal((await call(`/admin/users/${me.id}`, { method: 'DELETE', cookie: adminCookie })).status, 400);
});

test('wrong password does not reveal whether the email exists', async () => {
  await register('enum@test.invalid');
  const known = await call('/auth/login', { method: 'POST', body: { email: 'enum@test.invalid', password: 'nope-nope-nope-nope' } });
  const unknown = await call('/auth/login', { method: 'POST', body: { email: 'ghost@test.invalid', password: 'nope-nope-nope-nope' } });
  assert.equal(known.status, 401); assert.deepEqual(known.body, unknown.body);
});

test('attempts started on an older module version cannot be answered or finished', async () => {
  const cookie = await register('stale@test.invalid');
  const start = await call('/modules/deepfakes/attempts', { method: 'POST', cookie });
  await pool.query('UPDATE attempts SET module_version = module_version - 1 WHERE id = $1', [start.body.attemptId]);
  const ans = await call(`/attempts/${start.body.attemptId}/answer`, { method: 'POST', cookie, body: { qid: start.body.questions[0].id, choice: 0 } });
  assert.equal(ans.status, 409); assert.equal(ans.body.stale, true);
  const fin = await call(`/attempts/${start.body.attemptId}/finish`, { method: 'POST', cookie });
  assert.equal(fin.status, 409);
  assert.equal((await pool.query('SELECT 1 FROM attempts WHERE id = $1', [start.body.attemptId])).rowCount, 0, 'stale attempt discarded');
});
