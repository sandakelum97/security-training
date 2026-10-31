# Security

## Reporting a vulnerability
Please report privately through GitHub's **Security → Report a vulnerability** on this repository. Don't open a public issue. Include steps to reproduce and the impact you expect.

## Security design
| Area | Control |
|---|---|
| Grading | Answers and explanations never leave the server until a question is answered. Each question can be answered once, and scores are computed server-side. The client can't submit a score. |
| Sessions | Signed (HS256) token in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie (`__Host-` prefix in production). The user is re-loaded from the database on every request. Logout, role change and deletion revoke all sessions via `token_version`. |
| CSRF | SameSite=Strict, plus a required `X-Requested-With` header and an `Origin` check on every state-changing request. No CORS is enabled. |
| XSS | Strict CSP (`script-src 'self'`, no inline scripts or styles, `frame-ancestors 'none'`). The frontend never uses `innerHTML`: all text is set with `textContent`. Names are restricted to letters, spaces, `.`, `'` and `-`. |
| Passwords | scrypt (N=2^15, r=8, p=3, an OWASP-recommended setting that uses 32 MiB per hash) with a random salt. Follows NIST SP 800-63B-4: at least 15 characters, no composition rules, a breached-password check (HIBP k-anonymity, optional), and no name or email inside the password. |
| Brute force | Per-IP rate limits (20 auth requests per 15 min, 600 API requests per 15 min). Accounts lock for 15 min after 10 failed sign-ins. Unknown emails get the same response and timing as wrong passwords. |
| Input | Zod validation on every body and parameter. JSON bodies are capped at 10 kB. Every SQL query is parameterised. |
| Database | TLS with certificate verification is on by default. Only `PGSSL=disable` turns it off, for local development. |
| Errors | Stack traces and SQL errors are never returned to clients. |
| Privacy | The public leaderboard shows only "First L." and users can opt out. Certificates are reachable only by an unguessable UUID. |

**Note on serverless rate limiting:** the built-in limiter keeps counts in memory for each instance. On Vercel, also enable the [Vercel Firewall](https://vercel.com/docs/vercel-firewall) rate-limiting rules for `/api/auth/*`. The per-account lockout is stored in the database, so it applies across instances.
