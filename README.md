# Open Security Awareness

A free, open-source, animated training platform for **cyber security**, **AI security** and **AI basics**, written in plain language that anyone can follow. Each module is a short set of animated lesson cards followed by a quiz with instant feedback. Quiz formats include multiple choice, true/false and realistic email simulations where you can inspect link destinations. Learners who pass get a verifiable certificate.

Built to be self-hosted by any organisation, school or community group. No vendor branding; set your own name with `ORG_NAME`.

## Modules

| Track | Module | Level |
|---|---|---|
| Cyber security | Spotting Phishing | Beginner |
| | Passwords, Passkeys & MFA | Beginner |
| | Social Engineering & Payment Fraud | Beginner |
| | Secure Devices & Safe Browsing | Beginner |
| | Protecting Data & Privacy | Beginner |
| | Ransomware, Backups & Reporting | Intermediate |
| AI security | Using AI Tools Safely | Beginner |
| | AI Attacks Explained: Prompt Injection & More (OWASP LLM Top 10 2025) | Intermediate |
| | Deepfakes & AI-Powered Scams | Beginner |
| AI basics | AI Fundamentals | Beginner |
| | Responsible AI & the Rules (NIST AI RMF, ISO/IEC 42001, EU AI Act) | Intermediate |
| | Getting Great Results from AI | Beginner |

Every module lists its sources (NIST, CISA, FBI IC3, UK NCSC, OWASP, MITRE, ICO, European Commission). Questions are drawn at random from a larger pool on each attempt.

## Features
- Animated lessons with a progress bar, an animated **shield meter** that reacts to every answer, and a celebration on passing. All motion turns off with the OS "reduce motion" setting.
- Light and dark mode, mobile-friendly, keyboard accessible.
- Progress tracking, an opt-in leaderboard, and printable certificates anyone can verify by link.
- Admin dashboard: completion stats per module, user search, learner history, role changes and account removal.
- Restrict sign-up to your email domain, or close registration entirely.

## Quick start (local)
Requirements: Node.js 20+ and any PostgreSQL 13+.

```bash
git clone https://github.com/sandakelum97/security-training.git
cd security-training
npm install
cp .env.example .env        # fill in DATABASE_URL and SESSION_SECRET
npm run db:setup            # creates the tables (safe to re-run)
npm run dev                 # http://localhost:3000
```

Create your account in the app, then make yourself an admin:
```bash
npm run make-admin -- you@example.org
```

## Database (replaces Supabase)
The app uses plain PostgreSQL via `pg`, so it works with any provider. Recommended free option: **[Neon](https://neon.com/pricing)**. Its free plan needs no credit card and, at the time of writing, includes 1 GB of storage and 100 CU-hours of compute per project, and it scales to zero after 5 minutes idle. Check the pricing page for current limits.

1. Create a Neon project and copy the **pooled** connection string (the host contains `-pooler`).
2. Set it as `DATABASE_URL` (keep `sslmode=require`).
3. Run `npm run db:setup` once against it.

Other options that work unchanged: local Postgres, Docker `postgres:16`, AWS RDS, Azure Database for PostgreSQL, Google Cloud SQL, or a new Supabase project.

## Deploy
**Vercel:** import the repo, set `DATABASE_URL`, `SESSION_SECRET` and (optionally) `ORG_NAME`, then deploy. `vercel.json` serves `public/` statically, routes `/api/*` to the serverless function and adds security headers.

**Docker / any Node host:**
```bash
docker build -t security-awareness .
docker run -p 3000:3000 --env-file .env security-awareness
```
Put it behind HTTPS (and set `TRUST_PROXY=1` if behind a reverse proxy).

## Adding or editing content
Modules are JSON files in [`content/modules/`](content/modules). No database changes are needed.
```jsonc
{
  "slug": "my-module", "version": 1, "track": "cyber", "order": 7,
  "title": "…", "icon": "🔐", "summary": "…", "level": "Beginner", "minutes": 6,
  "lessons": [{ "title": "…", "visual": "🔐", "points": ["…"], "tip": "optional" }],
  "questionsPerAttempt": 8, "passMark": 0.75,
  "questions": [
    { "id": "mm-1", "type": "mcq", "q": "…", "options": ["…", "…"], "answer": 0, "why": "…" },
    { "id": "mm-2", "type": "tf",  "q": "…", "answer": true, "why": "…" },
    { "id": "mm-3", "type": "email", "answer": "phish", "why": "…",
      "email": { "from": "…", "subject": "…", "body": "…", "links": [{ "text": "…", "href": "…" }] } }
  ],
  "sources": [{ "title": "…", "url": "https://…" }]
}
```
Run `npm run validate` to check your file. Content is plain text only (no HTML) and every fact should cite a primary source in `sources`. Bump `version` when you change questions.

## Project layout
```
api/index.js        Vercel serverless entry
server.js           Node/Docker entry
src/app.js          Express API (auth, quizzes, admin)
src/auth.js         Password hashing, password policy, sessions
src/content.js      Loads and validates content/modules/*.json
db/schema.sql       Database schema
public/             Frontend (vanilla JS, no build step)
test/               Integration and security tests (npm test)
```

## Security
See [SECURITY.md](SECURITY.md) for the full design: server-side grading, HttpOnly session cookies, CSRF protection, strict CSP with no `innerHTML`, scrypt password hashing, NIST SP 800-63B-4 password rules, rate limits and account lockout. `npm test` runs the security test suite. CI runs it on every push.

## How this compares
Research into existing awareness platforms shaped the design:

- **Commercial platforms** (e.g. KnowBe4, Hoxhunt, Proofpoint, SoSafe, CybSafe) focus on short microlearning, phishing simulation, gamification (points, leaderboards) and compliance reporting. Comparison sites such as [G2](https://www.g2.com/compare/hoxhunt-vs-knowbe4-security-awareness-training) and [OutThink](https://outthink.io/compare/hoxhunt-vs-knowbe4/) summarise the differences. This project brings the microlearning, gamification, certificates and reporting to a free, self-hosted package.
- **Open-source tools** tend to cover one niche: [Gophish](https://github.com/gophish/gophish) for phishing simulation campaigns, or hands-on labs for technical staff. Few cover general-audience lessons, and fewer still cover AI security or AI literacy. Pair this platform with Gophish if you also want live phishing simulations.
- **Guidance:** [NIST SP 800-50 Rev. 1](https://csrc.nist.gov/pubs/sp/800/50/r1/final) (2024) recommends treating awareness as a continuous, role-based learning program, and the [EU AI Act](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai) has required AI literacy from providers and deployers since 2 February 2025. The AI tracks here help with both.

## License
[MIT](LICENSE). Content sources keep their own terms. Links are provided for further reading.
