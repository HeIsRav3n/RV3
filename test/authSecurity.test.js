'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { hashPassword, verifyPassword, hashSessionToken } = require('../server/services/auth');
const middlewareAuth = require('../server/middleware/auth');

test('passwords use Argon2id and verify without exposing plaintext', async () => {
  const password = 'correct horse battery staple';
  const hash = await hashPassword(password);
  assert.match(hash, /^\$argon2id\$/);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword('wrong password', hash), false);
});

test('legacy password hashes remain verifiable for migration', async () => {
  const password = 'legacy-password';
  const legacy = crypto.createHash('sha256').update(password + require('../server/config').apiSecret).digest('hex');
  assert.equal(await verifyPassword(password, legacy), true);
  assert.equal(await verifyPassword('wrong password', legacy), false);
  assert.equal(await verifyPassword(password, 'not-a-valid-legacy-hash'), false);
});

test('session persistence uses a one-way token digest', () => {
  const token = 'session-token-for-test';
  const digest = hashSessionToken(token);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.notEqual(digest, token);
  assert.equal(digest, hashSessionToken(token));
});

test('API middleware requires an authenticated session and ignores bearer headers', () => {
  let called = false;
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  middlewareAuth({ headers: { 'x-rv3-token': 'legacy-secret' } }, res, () => { called = true; });
  assert.equal(called, false);
  assert.equal(res.code, 401);

  middlewareAuth({ session: { userId: 'operator' }, headers: {} }, res, () => { called = true; });
  assert.equal(called, true);
});
