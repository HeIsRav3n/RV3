'use strict';

const { sql, useDatabase } = require('../db');

function parseAmount(value) {
  return /^[0-9]+$/.test(String(value ?? '')) ? BigInt(String(value)) : null;
}

function validateReservation(request, policy) {
  if (!useDatabase()) throw new Error('Durable PostgreSQL is required for live approval reservations.');
  if (!request?.approvalId || !request?.idempotencyKey || !request?.taskId) throw new Error('Approval, idempotency, and task IDs are required.');
  const amount = parseAmount(request.valueWei ?? '0');
  if (amount == null) throw new Error('Transaction value must be a non-negative integer in wei.');
  if (amount > policy.maxTxValueWei) throw new Error('Transaction value exceeds the configured per-transaction cap.');
  return amount;
}

let ready = false;
async function ensureTables() {
  if (ready) return;
  const db = sql();
  await db`CREATE TABLE IF NOT EXISTS rv3_approvals (
    id TEXT PRIMARY KEY, task_id TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
    chain TEXT NOT NULL, contract_address TEXT NOT NULL, value_wei NUMERIC(78,0) NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'consumed', 'rejected', 'expired')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL, consumed_at TIMESTAMPTZ
  )`;
  await db`CREATE TABLE IF NOT EXISTS rv3_spend_reservations (
    id TEXT PRIMARY KEY, approval_id TEXT NOT NULL REFERENCES rv3_approvals(id), amount_wei NUMERIC(78,0) NOT NULL,
    day DATE NOT NULL DEFAULT CURRENT_DATE, status TEXT NOT NULL CHECK (status IN ('reserved', 'settled', 'released')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await db`CREATE TABLE IF NOT EXISTS rv3_audit_events (
    id BIGSERIAL PRIMARY KEY, task_id TEXT, type TEXT NOT NULL,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  ready = true;
}

async function reserve(request, policy) {
  const amount = validateReservation(request, policy);
  await ensureTables();
  const db = sql();
  // Serialize the short cap check + write transaction. This prevents two
  // concurrent operators/instances from both passing a stale daily total.
  return db.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(7833001)`;
    const prior = await tx`SELECT id FROM rv3_approvals WHERE idempotency_key = ${request.idempotencyKey}`;
    if (prior.length) throw new Error('This request has already been submitted.');
    const totals = await tx`SELECT COALESCE(SUM(amount_wei), 0) AS total FROM rv3_spend_reservations WHERE day = CURRENT_DATE AND status IN ('reserved', 'settled')`;
    const spent = BigInt(String(totals[0]?.total || '0'));
    if (spent + amount > policy.dailySpendWei) throw new Error('Transaction would exceed the configured daily spend cap.');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await tx`INSERT INTO rv3_approvals (id, task_id, idempotency_key, chain, contract_address, value_wei, status, expires_at)
      VALUES (${request.approvalId}, ${request.taskId}, ${request.idempotencyKey}, ${request.chain}, ${request.contractAddress}, ${amount.toString()}, 'approved', ${expiresAt})`;
    await tx`INSERT INTO rv3_spend_reservations (id, approval_id, amount_wei, status)
      VALUES (${`reservation_${request.approvalId}`}, ${request.approvalId}, ${amount.toString()}, 'reserved')`;
    return { approvalId: request.approvalId, amountWei: amount.toString(), expiresAt };
  });
}

async function settle(approvalId) {
  if (!useDatabase()) throw new Error('Durable PostgreSQL is required for approval settlement.');
  await ensureTables();
  const db = sql();
  return db.begin(async tx => {
    await tx`UPDATE rv3_approvals SET status = 'consumed', consumed_at = NOW() WHERE id = ${approvalId} AND status = 'approved'`;
    await tx`UPDATE rv3_spend_reservations SET status = 'settled' WHERE approval_id = ${approvalId} AND status = 'reserved'`;
  });
}

async function release(approvalId, reason = 'request_failed') {
  if (!useDatabase()) throw new Error('Durable PostgreSQL is required for approval release.');
  await ensureTables();
  const db = sql();
  return db.begin(async tx => {
    await tx`UPDATE rv3_approvals SET status = 'rejected' WHERE id = ${approvalId} AND status = 'approved'`;
    await tx`UPDATE rv3_spend_reservations SET status = 'released' WHERE approval_id = ${approvalId} AND status = 'reserved'`;
    await tx`INSERT INTO rv3_audit_events (task_id, type, detail)
      SELECT task_id, 'approval_released', jsonb_build_object('approvalId', id, 'reason', ${reason})
      FROM rv3_approvals WHERE id = ${approvalId}`;
  });
}

module.exports = { reserve, settle, release, validateReservation };
