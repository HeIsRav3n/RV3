'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rv3-auth-'));
process.env.DATA_DIR = dataDir;
process.env.ADMIN_EMAIL = 'owner@example.com';
process.env.API_SECRET = 'legacy-test-secret';

const auth = require('../server/services/auth');

(async () => {
  assert.deepStrictEqual(await auth.getAuthStatus(), { needsBootstrap: true, adminConfigured: true });
  await assert.rejects(() => auth.register('attacker@example.com', 'long-password-for-test'), /not authorized/);
  await assert.rejects(() => auth.register('owner@example.com', 'too-short'), /14 characters/);

  const created = await auth.register('OWNER@example.com', 'correct horse battery staple');
  assert.equal(created.isAdmin, true);
  assert.equal((await auth.getAuthStatus()).needsBootstrap, false);
  await assert.rejects(() => auth.register('owner@example.com', 'another long password'), /closed/);
  await assert.rejects(() => auth.login('owner@example.com', 'incorrect password'), /Invalid email or password/);

  const login = await auth.login('owner@example.com', 'correct horse battery staple');
  assert.equal(login.user.email, 'owner@example.com');
  assert.equal((await auth.verifyToken(login.token)).isAdmin, true);
  const req = { headers: { cookie: `theme=dark; rv3_session=${login.token}` } };
  assert.equal(auth.readSessionToken(req), login.token);

  const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'users.json'), 'utf8'));
  assert.match(stored.authorized[0].passwordHash, /^scrypt\$/);
  assert(!JSON.stringify(stored).includes(login.token), 'raw session token must not be persisted');

  await auth.logout(login.token);
  assert.equal(await auth.verifyToken(login.token), null);
  console.log('ALL AUTH SECURITY TESTS PASSED');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
