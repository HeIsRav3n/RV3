-- RV3 durable production controls. Apply through a controlled migration
-- pipeline using the server database role only (Neon, Supabase, or compatible PostgreSQL).

CREATE TABLE IF NOT EXISTS rv3_approvals (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  chain TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  value_wei NUMERIC(78, 0) NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'consumed', 'rejected', 'expired')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS rv3_spend_reservations (
  id TEXT PRIMARY KEY,
  approval_id TEXT NOT NULL REFERENCES rv3_approvals(id),
  amount_wei NUMERIC(78, 0) NOT NULL CHECK (amount_wei >= 0),
  day DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'settled', 'released')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS rv3_spend_reservations_day_idx ON rv3_spend_reservations(day, status);

CREATE TABLE IF NOT EXISTS rv3_worker_leases (
  name TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rv3_observed_events (
  event_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  chain TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  payload JSONB NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rv3_audit_events (
  id BIGSERIAL PRIMARY KEY,
  task_id TEXT,
  type TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS rv3_audit_events_task_idx ON rv3_audit_events(task_id, created_at DESC);
