// Validates every module in content/modules (run in CI before merging content changes).
process.env.DATABASE_URL ||= 'postgres://unused';
process.env.SESSION_SECRET ||= 'x'.repeat(32);
const { modules } = await import('../src/content.js');
for (const m of modules.values()) console.log(`✔ ${m.track.padEnd(12)} ${m.slug.padEnd(22)} ${m.questions.length} questions`);
console.log(`${modules.size} modules valid.`);
