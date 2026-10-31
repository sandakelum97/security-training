// Single-page app. All DOM is built with h(), which only ever uses textContent, so content and
// user data can never be interpreted as HTML (no innerHTML anywhere).
const $main = document.getElementById('main');
const TRACKS = {
  cyber: ['Cyber security', 'Everyday habits that stop the most common attacks.'],
  'ai-security': ['AI security', 'Use AI safely and understand how AI systems get attacked.'],
  'ai-basics': ['AI basics', 'What AI is, how to use it well and how it is governed.'],
};
const state = { me: null, catalog: null };

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k.startsWith('--')) el.style.setProperty(k, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}
const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...kids);
  return el;
};

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method, credentials: 'same-origin',
    headers: { 'X-Requested-With': 'fetch', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/me' && !path.startsWith('/auth')) { state.me = null; go('#/login'); }
  if (data.stale) { toast(data.error); setTimeout(render, 1500); }
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: res.status });
  return data;
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3200);
}
const go = hash => { if (location.hash === hash) render(); else location.hash = hash; };
const view = (...nodes) => { $main.replaceChildren(...nodes); $main.focus({ preventScroll: true }); window.scrollTo(0, 0); };
const date = d => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Navigation ----------
function renderNav(route) {
  const links = state.me
    ? [['#/', 'Learn'], ['#/me', 'My progress'], ['#/leaderboard', 'Leaderboard'], state.me.role === 'admin' && ['#/admin', 'Admin']]
    : [['#/login', 'Sign in']];
  document.getElementById('nav').replaceChildren(
    ...links.filter(Boolean).map(([href, label]) => h('a', { href, 'aria-current': route === href ? 'page' : null }, label)),
    ...(state.me ? [h('button', { type: 'button', onclick: logout }, 'Sign out')] : []));
}
async function logout() { await api('/auth/logout', { method: 'POST' }).catch(() => {}); state.me = null; go('#/login'); }

// ---------- Auth ----------
function authView(mode = 'login') {
  const err = h('p', { class: 'error', role: 'alert' });
  const isReg = mode === 'register';
  const field = (id, label, type, extra = {}) => [h('label', { for: id }, label), h('input', { id, name: id, type, required: true, ...extra })];
  const form = h('form', { novalidate: true, onsubmit: async e => {
      e.preventDefault(); err.textContent = '';
      const f = Object.fromEntries(new FormData(form));
      const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        await api(`/auth/${mode}`, { method: 'POST', body: isReg ? f : { email: f.email, password: f.password } });
        state.me = await api('/me'); go('#/');
      } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
    } },
    isReg && field('name', 'Your name', 'text', { autocomplete: 'name', maxlength: 60 }),
    field('email', 'Email', 'email', { autocomplete: 'email' }),
    field('password', 'Password', 'password', { autocomplete: isReg ? 'new-password' : 'current-password', minlength: isReg ? 15 : null }),
    isReg && h('p', { class: 'hint' }, 'At least 15 characters. A few random words together, like "tulip ladder ocean pocket", is strong and easy to remember.'),
    err,
    h('button', { class: 'btn', type: 'submit' }, isReg ? 'Create account' : 'Sign in'));
  const tab = (m, label) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(m === mode), onclick: () => view(authView(m)) }, label);
  return h('section', { class: 'auth' },
    h('div', { class: 'auth-intro' },
      h('h1', {}, 'Learn to spot the tricks before they work on you.'),
      h('p', {}, 'Short, interactive lessons on phishing, passwords, scams and AI, followed by a quick quiz. About seven minutes each, no jargon.'),
      h('div', { class: 'track-pills' }, Object.entries(TRACKS).map(([k, [name]]) => h('span', { class: `pill ${k}` }, name)))),
    h('div', { class: 'panel' }, h('div', { class: 'tabs', role: 'tablist' }, tab('login', 'Sign in'), tab('register', 'Create account')), form,
      !isReg && h('p', { class: 'hint' }, h('a', { href: '#/forgot' }, 'Forgot your password?'))));
}

// ---------- Password reset ----------
const authCard = (title, intro, ...body) => h('section', { class: 'auth' },
  h('div', { class: 'auth-intro' }, h('h1', {}, title), h('p', {}, intro)), h('div', { class: 'panel' }, ...body));

function forgotView() {
  const msg = h('p', { role: 'status', class: 'hint' });
  const form = h('form', { novalidate: true, onsubmit: async e => {
      e.preventDefault(); const btn = form.querySelector('button'); btn.disabled = true;
      try { const r = await api('/auth/forgot', { method: 'POST', body: { email: form.email.value } }); msg.textContent = r.message; }
      catch (ex) { msg.textContent = ex.message; btn.disabled = false; }
    } },
    h('label', { for: 'email' }, 'Email'), h('input', { id: 'email', name: 'email', type: 'email', required: true, autocomplete: 'email' }),
    h('div', { class: 'row section' }, h('button', { class: 'btn', type: 'submit' }, 'Send reset link'), h('a', { href: '#/login' }, 'Back to sign in')), msg);
  return authCard('Reset your password', 'Enter the email you signed up with. If email is set up for this site, we will send you a link that works for 30 minutes.', form);
}

function resetView(token) {
  const err = h('p', { class: 'error', role: 'alert' });
  const form = h('form', { novalidate: true, onsubmit: async e => {
      e.preventDefault(); err.textContent = ''; const btn = form.querySelector('button'); btn.disabled = true;
      try { await api('/auth/reset', { method: 'POST', body: { token, password: form.password.value } }); toast('Password changed. Sign in with your new password.'); state.me = null; go('#/login'); }
      catch (ex) { err.textContent = ex.message; btn.disabled = false; }
    } },
    h('label', { for: 'password' }, 'New password'), h('input', { id: 'password', name: 'password', type: 'password', required: true, minlength: 15, autocomplete: 'new-password' }),
    h('p', { class: 'hint' }, 'At least 15 characters. A few random words together is strong and easy to remember.'),
    err, h('button', { class: 'btn', type: 'submit' }, 'Set new password'));
  return authCard('Choose a new password', 'After you save it, you will be signed out on every device and can sign in with the new password.', form);
}

function changePasswordForm() {
  const err = h('p', { class: 'error', role: 'alert' });
  const form = h('form', { class: 'panel', novalidate: true, onsubmit: async e => {
      e.preventDefault(); err.textContent = ''; const btn = form.querySelector('button'); btn.disabled = true;
      try { await api('/me/password', { method: 'POST', body: { current: form.current.value, password: form.password.value } }); form.reset(); toast('Password changed. Other devices have been signed out.'); }
      catch (ex) { err.textContent = ex.message; }
      btn.disabled = false;
    } },
    h('label', { for: 'current' }, 'Current password'), h('input', { id: 'current', name: 'current', type: 'password', required: true, autocomplete: 'current-password' }),
    h('label', { for: 'password' }, 'New password'), h('input', { id: 'password', name: 'password', type: 'password', required: true, minlength: 15, autocomplete: 'new-password' }),
    h('p', { class: 'hint' }, 'At least 15 characters.'), err, h('button', { class: 'btn', type: 'submit' }, 'Change password'));
  return h('section', { class: 'section narrow-left' }, h('h2', {}, 'Change password'), form);
}

// ---------- Hub ----------
async function hubView() {
  const [catalog, attempts] = await Promise.all([state.catalog ??= api('/modules'), api('/me/attempts')]);
  state.catalog = catalog;
  const best = {};
  for (const a of attempts) best[a.module_slug] = Math.max(best[a.module_slug] ?? -1, a.passed ? a.score / a.total : -1);
  const done = catalog.filter(m => best[m.slug] >= 0).length;
  const pct = Math.round((done / catalog.length) * 100);
  const first = state.me.name.split(' ')[0];
  return h('div', { class: 'wrap' },
    h('section', { class: 'hero' },
      h('div', {}, h('h1', {}, `Hi ${first}.`), h('p', { class: 'muted' },
        done === catalog.length ? 'You have completed every module. Great work.' : `${done} of ${catalog.length} modules complete. Pick one to start.`)),
      h('div', { class: 'ring', '--p': pct, role: 'img', 'aria-label': `${pct}% complete` }, h('span', {}, `${pct}%`))),
    Object.entries(TRACKS).map(([key, [name, blurb]]) => h('section', { class: `track t-${key}` },
      h('div', { class: 'track-head' }, h('h2', {}, name), h('p', { class: 'muted' }, blurb)),
      h('div', { class: 'tiles' }, catalog.filter(m => m.track === key).sort((a, b) => a.order - b.order).map(m =>
        h('a', { class: 'tile', href: `#/m/${m.slug}` },
          h('span', { class: 'emoji', 'aria-hidden': 'true' }, m.icon), h('h3', {}, m.title), h('p', {}, m.summary),
          h('span', { class: 'meta' }, h('span', {}, `${m.minutes} min, ${m.level.toLowerCase()}`),
            best[m.slug] >= 0 ? h('span', { class: 'done' }, `Passed ${Math.round(best[m.slug] * 100)}%`) : null)))))));
}

// ---------- Module: lessons -> quiz -> result ----------
async function moduleView(slug) {
  const data = await api(`/modules/${encodeURIComponent(slug)}/attempts`, { method: 'POST' });
  const root = h('div', { class: `narrow player t-${data.module.track}` });
  let i = 0;
  const lesson = () => {
    const L = data.lessons[i], last = i === data.lessons.length - 1;
    root.replaceChildren(
      h('a', { href: '#/' }, 'Back to modules'),
      h('div', { class: 'steps', 'aria-hidden': 'true' }, data.lessons.map((_, k) => h('i', { class: k <= i ? 'on' : '' }))),
      h('article', { class: 'lesson enter', 'aria-live': 'polite' },
        h('p', { class: 'muted' }, `${data.module.title}: part ${i + 1} of ${data.lessons.length}`),
        h('div', { class: 'stage', 'aria-hidden': 'true' }, h('span', {}, L.visual)),
        h('h2', {}, L.title), h('ul', {}, L.points.map(p => h('li', {}, p))), L.tip && h('p', { class: 'tip' }, L.tip)),
      h('div', { class: 'nav-row' },
        h('button', { class: 'btn ghost', type: 'button', disabled: i === 0, onclick: () => { i--; lesson(); } }, 'Back'),
        h('div', { class: 'row' },
          !last && h('button', { class: 'btn ghost', type: 'button', onclick: quiz }, 'Skip to quiz'),
          h('button', { class: 'btn', type: 'button', onclick: () => (last ? quiz() : (i++, lesson())) }, last ? 'Start the quiz' : 'Next'))));
  };

  let level = 100, qi = 0, right = 0;
  const shield = shieldMeter();
  const quiz = () => {
    const Q = data.questions[qi];
    const status = h('span', { class: 'status' });
    const setStatus = () => {
      shield.set(level);
      status.textContent = level >= 70 ? 'Shield strong' : level >= 40 ? 'Shield damaged' : 'Shield critical';
    };
    setStatus();
    const opts = h('div', { class: 'options', role: 'group', 'aria-label': 'Answers' });
    const fb = h('div', { 'aria-live': 'polite' });
    const order = Q.options.map((_, k) => k);
    if (Q.type === 'mcq') for (let k = order.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [order[k], order[j]] = [order[j], order[k]]; }
    const buttons = order.map(k => h('button', { class: 'opt', type: 'button', onclick: () => answer(k) }, Q.options[k]));
    opts.append(...buttons);

    async function answer(choice) {
      buttons.forEach(b => (b.disabled = true));
      try {
        const r = await api(`/attempts/${data.attemptId}/answer`, { method: 'POST', body: { qid: Q.id, choice } });
        if (r.correct) { right++; level = Math.min(100, level + 5); } else { level = Math.max(0, level - 20); shield.hit(); }
        setStatus();
        buttons[order.indexOf(r.answer)]?.classList.add('right');
        if (!r.correct) buttons[order.indexOf(choice)]?.classList.add('wrong');
        const last = qi === data.questions.length - 1;
        const next = h('button', { class: 'btn', type: 'button', onclick: () => (last ? finish() : (qi++, quiz())) }, last ? 'See my result' : 'Next question');
        fb.replaceChildren(h('div', { class: `feedback enter ${r.correct ? 'good' : 'badf'}` },
          h('h3', {}, r.correct ? 'Correct' : 'Not quite'), h('p', {}, r.why), next));
        next.focus();
      } catch (ex) { toast(ex.message); buttons.forEach(b => (b.disabled = false)); }
    }

    root.replaceChildren(
      h('div', { class: 'quizhead' }, shield.el, h('div', {}, h('p', { class: 'muted' }, `Question ${qi + 1} of ${data.questions.length}`), status)),
      h('div', { class: 'enter' }, Q.type === 'email' && emailMock(Q.email), h('p', { class: 'question' }, Q.prompt), opts, fb));
  };

  async function finish() {
    try {
      const r = await api(`/attempts/${data.attemptId}/finish`, { method: 'POST' });
      const big = shieldMeter(); big.set(r.passed ? 100 : Math.round((r.score / r.total) * 100));
      root.replaceChildren(h('section', { class: 'result enter' }, big.el,
        h('p', { class: 'score' }, `${r.score} / ${r.total}`),
        h('h2', {}, r.passed ? 'Passed. Your shield held.' : 'Not passed this time.'),
        h('p', { class: 'muted' }, r.passed ? 'Your certificate is ready.' : `You need ${Math.ceil(data.module.passMark * r.total)} correct to pass. Review the lessons and try again. Questions change each time.`),
        h('div', { class: 'row' },
          r.passed && h('a', { class: 'btn', href: `#/cert/${r.certificateId}` }, 'View certificate'),
          h('button', { class: 'btn ghost', type: 'button', onclick: () => render() }, 'Try again'),
          h('a', { class: 'btn ghost', href: '#/' }, 'Back to modules')),
        h('div', { class: 'sources' }, h('h3', {}, 'Learn more from the sources'),
          h('ul', {}, data.sources.map(s => h('li', {}, h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.title)))))));
      if (r.passed) confetti();
    } catch (ex) { toast(ex.message); }
  }
  lesson();
  return root;
}

function emailMock(m) {
  return h('div', { class: 'mail', role: 'group', 'aria-label': 'Example email' },
    h('header', {}, h('div', {}, h('b', {}, 'From'), m.from), h('div', {}, h('b', {}, 'Subject'), m.subject)),
    h('div', { class: 'body' }, m.body,
      m.links.map(l => h('div', {}, h('button', { class: 'mlink', type: 'button', 'aria-label': `${l.text}. Link goes to ${l.href}` },
        l.text, h('span', { class: 'href', 'aria-hidden': 'true' }, `Goes to: ${l.href}`)))),
      m.links.length ? h('p', { class: 'hint' }, 'Hover over or tap the link to see where it really goes.') : null));
}

function shieldMeter() {
  const id = 'c' + Math.random().toString(36).slice(2);
  const path = 'M50 4 8 20v30c0 26 18 46 42 54 24-8 42-28 42-54V20Z';
  const fill = svg('rect', { class: 'fill', x: 0, width: 100, y: 0, height: 110, 'clip-path': `url(#${id})` });
  const el = svg('svg', { class: 'shield', viewBox: '0 0 100 110', role: 'img', 'aria-label': 'Security shield' },
    svg('defs', {}, svg('clipPath', { id }, svg('path', { d: path }))),
    svg('path', { d: path, fill: 'var(--line)' }), fill,
    svg('path', { d: path, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 4, 'stroke-linejoin': 'round' }));
  return {
    el,
    set(level) {
      const y = 110 - (110 * level) / 100;
      fill.setAttribute('y', y); fill.setAttribute('height', 110 - y);
      fill.setAttribute('fill', level >= 70 ? 'var(--ok)' : level >= 40 ? 'var(--warn)' : 'var(--bad)');
      el.setAttribute('aria-label', `Security shield at ${level}%`);
    },
    hit() { el.classList.remove('hit'); void el.getBBox(); el.classList.add('hit'); },
  };
}

function confetti() {
  if (reduced) return;
  const c = h('canvas', { id: 'confetti' }); document.body.append(c);
  const ctx = c.getContext('2d'); c.width = innerWidth; c.height = innerHeight;
  const colors = ['#2F5BFF', '#C8325A', '#0E8F7E', '#F5A524', '#12A150'];
  const bits = Array.from({ length: 140 }, () => ({ x: c.width / 2, y: c.height / 3, vx: (Math.random() - .5) * 14,
    vy: Math.random() * -12 - 4, s: 5 + Math.random() * 6, r: Math.random() * 6, c: colors[Math.floor(Math.random() * 5)] }));
  let t = 0;
  (function frame() {
    ctx.clearRect(0, 0, c.width, c.height);
    for (const b of bits) { b.vy += .35; b.x += b.vx; b.y += b.vy; b.r += .1; ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r); ctx.fillStyle = b.c; ctx.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2); ctx.restore(); }
    if (++t < 160) requestAnimationFrame(frame); else c.remove();
  })();
}

// ---------- Profile ----------
async function meView() {
  const attempts = await api('/me/attempts');
  const toggle = h('input', { type: 'checkbox', id: 'lb', checked: state.me.showOnLeaderboard, onchange: async e => {
    try { await api('/me', { method: 'PATCH', body: { showOnLeaderboard: e.target.checked } }); state.me.showOnLeaderboard = e.target.checked; toast('Saved'); }
    catch (ex) { e.target.checked = !e.target.checked; toast(ex.message); } } });
  return h('div', { class: 'wrap' },
    h('section', { class: 'hero' }, h('div', {}, h('h1', {}, 'My progress'), h('p', { class: 'muted' }, state.me.email))),
    h('label', { class: 'toggle', for: 'lb' }, toggle, 'Show my name on the leaderboard'),
    h('section', { class: 'section' }, h('h2', {}, 'Quiz history'),
      attempts.length ? attemptsTable(attempts, true) : h('p', {}, 'No quizzes yet. ', h('a', { href: '#/' }, 'Start your first module.'))),
    changePasswordForm());
}
function attemptsTable(rows, withCert) {
  return h('div', { class: 'scroll' }, h('table', {},
    h('thead', {}, h('tr', {}, ['Module', 'Score', 'Result', 'Date', withCert && 'Certificate'].filter(Boolean).map(t => h('th', { scope: 'col' }, t)))),
    h('tbody', {}, rows.map(a => h('tr', {},
      h('td', {}, a.title), h('td', {}, `${a.score} / ${a.total}`),
      h('td', {}, h('span', { class: `badge ${a.passed ? 'pass' : 'fail'}` }, a.passed ? 'Passed' : 'Not passed')),
      h('td', {}, date(a.completed_at)),
      withCert && h('td', {}, a.passed ? h('a', { href: `#/cert/${a.id}` }, 'View') : '–'))))));
}

// ---------- Leaderboard ----------
async function leaderboardView() {
  const rows = await api('/leaderboard');
  return h('div', { class: 'narrow' }, h('section', { class: 'hero' }, h('div', {}, h('h1', {}, 'Leaderboard'),
    h('p', { class: 'muted' }, 'Ranked by modules passed, then average best score. You can hide yourself in My progress.'))),
    rows.length ? h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['Rank', 'Name', 'Passed', 'Average'].map(t => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, rows.map((r, k) => h('tr', {}, h('td', { class: 'rank' }, ['🥇', '🥈', '🥉'][k] ?? k + 1), h('td', {}, r.name), h('td', {}, r.passed), h('td', {}, `${r.avg}%`))))))
      : h('p', {}, 'Nobody has passed a module yet. Be the first.'));
}

// ---------- Certificate (public, verifiable) ----------
async function certView(id) {
  const c = await api(`/certificates/${encodeURIComponent(id)}`);
  return h('div', { class: 'wrap' },
    h('div', { class: 'cert' }, h('p', {}, c.org), h('h1', {}, 'Certificate of completion'), h('p', {}, 'This certifies that'),
      h('p', { class: 'who' }, c.name), h('p', {}, 'has successfully completed'), h('h2', {}, c.module),
      h('p', {}, `with a score of ${c.score} / ${c.total} on ${date(c.completedAt)}`),
      h('small', {}, `Verify at ${location.origin}/#/cert/${id}`)),
    h('div', { class: 'row no-print' }, h('button', { class: 'btn', type: 'button', onclick: () => print() }, 'Print or save as PDF'),
      state.me && h('a', { class: 'btn ghost', href: '#/me' }, 'Back to my progress')));
}

// ---------- Admin ----------
async function adminView() {
  const stats = await api('/admin/stats');
  const list = h('div');
  const search = h('input', { type: 'search', placeholder: 'Search by name or email', 'aria-label': 'Search users' });
  const detail = h('div');
  let page = 1;
  const load = async () => {
    const { total, users } = await api(`/admin/users?search=${encodeURIComponent(search.value)}&page=${page}`);
    const actions = u => h('div', { class: 'row' },
      h('button', { class: 'btn ghost', type: 'button', onclick: () => history(u) }, 'History'),
      u.id !== state.me.id && h('button', { class: 'btn ghost', type: 'button', onclick: () => act(`Make ${u.name} ${u.role === 'admin' ? 'a learner' : 'an admin'}?`,
        () => api(`/admin/users/${u.id}`, { method: 'PATCH', body: { role: u.role === 'admin' ? 'user' : 'admin' } })) }, u.role === 'admin' ? 'Remove admin' : 'Make admin'),
      u.id !== state.me.id && h('button', { class: 'btn ghost', type: 'button', onclick: () => resetFor(u) }, 'Reset link'),
      u.id !== state.me.id && h('button', { class: 'btn danger', type: 'button', onclick: () => act(`Delete ${u.name} and all their results? This cannot be undone.`,
        () => api(`/admin/users/${u.id}`, { method: 'DELETE' })) }, 'Delete'));
    const rows = users.map(u => h('tr', {}, h('td', {}, u.name), h('td', {}, u.email),
      h('td', {}, h('span', { class: 'badge' }, u.role)), h('td', {}, u.modules_passed), h('td', {}, actions(u))));
    list.replaceChildren(h('p', { class: 'muted' }, `${total} users`), h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Name', 'Email', 'Role', 'Passed', 'Actions'].map(t => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, rows))),
      h('div', { class: 'row section' },
        h('button', { class: 'btn ghost', type: 'button', disabled: page === 1, onclick: () => { page--; load(); } }, 'Previous'),
        h('button', { class: 'btn ghost', type: 'button', disabled: page * 50 >= total, onclick: () => { page++; load(); } }, 'Next')));
  };
  const act = async (msg, fn) => { if (!confirm(msg)) return; try { await fn(); toast('Done'); load(); } catch (ex) { toast(ex.message); } };
  const resetFor = async u => {
    if (!confirm(`Create a one-time password reset link for ${u.name}? It works for 30 minutes.`)) return;
    try {
      const { link } = await api(`/admin/users/${u.id}/reset-link`, { method: 'POST' });
      const box = h('input', { type: 'text', readonly: true, value: link, 'aria-label': 'Reset link', onfocus: e => e.target.select() });
      detail.replaceChildren(h('section', { class: 'section panel' }, h('h2', {}, `Reset link for ${u.name}`),
        h('p', {}, 'Send this to them privately, for example in a direct message. Anyone with the link can set the password. It works once, for 30 minutes.'),
        box, h('div', { class: 'row section' }, h('button', { class: 'btn', type: 'button', onclick: async () => {
          try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch { box.focus(); toast('Press Ctrl+C to copy'); } } }, 'Copy link'))));
      detail.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
    } catch (ex) { toast(ex.message); }
  };
  const history = async u => {
    const rows = await api(`/admin/users/${u.id}/attempts`);
    detail.replaceChildren(h('section', { class: 'section' }, h('h2', {}, `History for ${u.name}`), rows.length ? attemptsTable(rows) : h('p', {}, 'No completed quizzes yet.')));
    detail.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  };
  let t; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { page = 1; load(); }, 300); });
  await load();
  return h('div', { class: 'wrap' }, h('section', { class: 'hero' }, h('h1', {}, 'Admin')),
    h('div', { class: 'stats' }, h('div', { class: 'stat' }, h('b', {}, stats.users), 'Learners'),
      stats.modules.map(m => h('div', { class: 'stat' }, h('b', {}, `${m.learners_passed}`), `passed ${m.title}`))),
    h('section', { class: 'section' }, h('h2', {}, 'Users'), search, list), detail);
}

// ---------- Router ----------
async function render() {
  const [, route = '', arg] = location.hash.match(/^#\/([^/]*)\/?(.*)$/) || [];
  const key = '#/' + route;
  if (state.me === null) state.me = await api('/me').catch(() => false);
  if (state.me?.org) document.getElementById('org').textContent = state.me.org;
  renderNav(key === '#/' || key === '#/m' ? '#/' : key);
  if (route === 'cert') return show(() => certView(arg));
  if (route === 'reset') return view(resetView(arg));
  if (route === 'forgot' && !state.me) return view(forgotView());
  if (!state.me) return view(authView());
  if (route === 'login') return go('#/');
  const routes = { '': hubView, m: () => moduleView(arg), me: meView, leaderboard: leaderboardView, admin: adminView };
  show(routes[route] ?? hubView);
}
async function show(fn) {
  try { view(await fn()); }
  catch (ex) { if (ex.status !== 401) view(h('div', { class: 'narrow section' }, h('h1', {}, 'That page could not load'), h('p', {}, ex.message), h('a', { class: 'btn', href: '#/' }, 'Go to modules'))); }
}
addEventListener('hashchange', render);
render();
