-- Meeras member accounts. The server never holds a readable Will: vaults.blob
-- is ciphertext produced in the member's browser with a key derived from their
-- passphrase (see the VAULT section of index.html).

CREATE TABLE accounts (
  id                  TEXT PRIMARY KEY,
  email               TEXT NOT NULL UNIQUE,          -- lower-cased
  created_at          TEXT NOT NULL,
  plan                TEXT,                          -- 'yearly' | 'lifetime' | NULL
  status              TEXT NOT NULL DEFAULT 'none',  -- 'none' | 'active' | 'past_due' | 'canceled'
  paid_until          TEXT,                          -- ISO date for yearly; NULL for lifetime
  stripe_customer     TEXT,
  stripe_subscription TEXT,
  consent_at          TEXT                           -- when the member agreed to store an encrypted record
);

CREATE TABLE login_tokens (
  token_hash TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  expires_at INTEGER NOT NULL,                       -- epoch ms
  used       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sessions (
  id_hash    TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_account ON sessions(account_id);

CREATE TABLE vaults (
  account_id TEXT PRIMARY KEY,
  blob       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE rate_limits (
  key          TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);

CREATE TABLE stripe_events (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE consult_requests (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  phone      TEXT,
  state      TEXT,
  topic      TEXT,
  message    TEXT,
  status     TEXT NOT NULL DEFAULT 'new'
);
