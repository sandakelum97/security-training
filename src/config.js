// Central config. Fails fast on missing/weak secrets so a misconfigured deploy never starts.
const env = process.env;

// Values copied from .env files often keep their quotes ("..."), which breaks URLs and secrets.
const clean = v => (v ?? '').trim().replace(/^(['"])(.*)\1$/s, '$2').trim();

function required(name) {
  const v = clean(env[name]);
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

const secret = required('SESSION_SECRET');
if (secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');

export const config = {
  databaseUrl: required('DATABASE_URL'),
  dbSsl: env.PGSSL !== 'disable',
  sessionKey: new TextEncoder().encode(secret),
  sessionHours: Number(env.SESSION_HOURS || 8),
  isProd: env.NODE_ENV === 'production' || !!env.VERCEL,
  trustProxy: env.TRUST_PROXY ?? (env.VERCEL ? '1' : '0'),
  appOrigin: clean(env.APP_ORIGIN).replace(/\/$/, ''), // e.g. https://training.example.org (optional extra origin check)
  orgName: env.ORG_NAME || 'Open Security Awareness',
  hibpCheck: env.HIBP_CHECK !== 'false', // breached-password check via k-anonymity API
  allowRegistration: env.ALLOW_REGISTRATION !== 'false',
  // Optional email for "forgot password". Needs all three; APP_ORIGIN is required so links can't be
  // poisoned via the Host header.
  resendApiKey: clean(env.RESEND_API_KEY),
  mailFrom: clean(env.MAIL_FROM), // e.g. "Security Awareness <training@yourdomain.com>"
  allowedEmailDomains: (env.ALLOWED_EMAIL_DOMAINS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
};
