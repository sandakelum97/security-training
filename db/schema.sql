-- Idempotent schema. Run with: npm run db:setup
-- Works on any PostgreSQL 13+ (Neon, local, Docker, RDS...). Uses built-in gen_random_uuid().

CREATE TABLE IF NOT EXISTS users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  email               text NOT NULL UNIQUE CHECK (email = lower(email) AND char_length(email) <= 254),
  password_hash       text NOT NULL,
  role                text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  token_version       integer NOT NULL DEFAULT 0,
  failed_logins       integer NOT NULL DEFAULT 0,
  locked_until        timestamptz,
  show_on_leaderboard boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- One row per quiz attempt. Answers are recorded server-side and graded server-side.
CREATE TABLE IF NOT EXISTS attempts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_slug    text NOT NULL,
  module_version integer NOT NULL,
  question_ids   text[] NOT NULL,
  answers        jsonb NOT NULL DEFAULT '{}'::jsonb,
  score          integer,
  total          integer NOT NULL,
  passed         boolean,
  started_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz
);

CREATE INDEX IF NOT EXISTS attempts_user_idx   ON attempts (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS attempts_passed_idx ON attempts (module_slug) WHERE passed;

-- One-time password reset tokens. Only a SHA-256 hash of the token is stored.
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets (user_id);
