// Loads training modules from /content/modules/*.json, validates them, and normalises every question
// to { id, type, prompt, options[], answer(index), why }. Content is plain text only (rendered with textContent).
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const dir = fileURLToPath(new URL('../content/modules/', import.meta.url));
const text = (max = 600) => z.string().trim().min(1).max(max);

const base = { id: z.string().regex(/^[a-z0-9-]{2,40}$/), why: text(700) };
const Question = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('mcq'), q: text(), options: z.array(text(220)).min(2).max(5), answer: z.number().int().min(0) }),
  z.object({ ...base, type: z.literal('tf'), q: text(), answer: z.boolean() }),
  z.object({
    ...base, type: z.literal('email'), answer: z.enum(['phish', 'legit']),
    email: z.object({
      from: text(120), subject: text(160), body: text(1200),
      links: z.array(z.object({ text: text(100), href: text(300) })).max(3).default([]),
    }),
  }),
]);

const Module = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/),
  version: z.number().int().positive(),
  track: z.enum(['cyber', 'ai-security', 'ai-basics']),
  order: z.number().int(),
  title: text(80), icon: text(8), summary: text(200), level: z.enum(['Beginner', 'Intermediate']), minutes: z.number().int().max(60),
  lessons: z.array(z.object({ title: text(90), visual: z.string().max(20), points: z.array(text(320)).min(1).max(5), tip: text(300).optional() })).min(2).max(8),
  questionsPerAttempt: z.number().int().min(3),
  passMark: z.number().min(0.5).max(1),
  questions: z.array(Question).min(3),
  sources: z.array(z.object({ title: text(160), url: z.url({ protocol: /^https$/ }) })).min(1),
}).strict();

function normalise(q) {
  if (q.type === 'mcq') {
    if (q.answer >= q.options.length) throw new Error(`answer out of range in ${q.id}`);
    return { id: q.id, type: 'mcq', prompt: q.q, options: q.options, answer: q.answer, why: q.why };
  }
  if (q.type === 'tf') return { id: q.id, type: 'tf', prompt: q.q, options: ['True', 'False'], answer: q.answer ? 0 : 1, why: q.why };
  return { id: q.id, type: 'email', prompt: 'Is this message phishing or legitimate?', email: q.email,
    options: ['Phishing', 'Legitimate'], answer: q.answer === 'phish' ? 0 : 1, why: q.why };
}

export function loadModules() {
  const modules = new Map();
  for (const file of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    const raw = JSON.parse(readFileSync(dir + file, 'utf8'));
    const parsed = Module.safeParse(raw);
    if (!parsed.success) throw new Error(`${file}: ${z.prettifyError(parsed.error)}`);
    const m = parsed.data;
    const ids = new Set(m.questions.map(x => x.id));
    if (ids.size !== m.questions.length) throw new Error(`${file}: duplicate question ids`);
    if (m.questionsPerAttempt > m.questions.length) throw new Error(`${file}: questionsPerAttempt > questions`);
    if (modules.has(m.slug)) throw new Error(`${file}: duplicate slug ${m.slug}`);
    const questions = m.questions.map(normalise);
    modules.set(m.slug, { ...m, questions, byId: new Map(questions.map(x => [x.id, x])) });
  }
  return modules;
}

export const modules = loadModules();

/** Public catalogue entry – no questions, no answers. */
export const catalogEntry = m => ({
  slug: m.slug, track: m.track, order: m.order, title: m.title, icon: m.icon, summary: m.summary,
  level: m.level, minutes: m.minutes, questions: m.questionsPerAttempt, passMark: m.passMark,
});

/** Question as sent to the browser: the answer and explanation stay on the server. */
export const publicQuestion = ({ answer, why, ...rest }) => rest;
