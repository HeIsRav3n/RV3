'use strict';
// Smoke test: batch-minter artifact + delegation service wiring (no live deploy).

const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const delegation = require('../server/services/delegation');

(async () => {
  // 1. Artifact present + well-formed
  const artifact = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'contracts', 'artifacts', 'RV3BatchMinter.json'), 'utf8'));
  assert.ok(artifact.bytecode.startsWith('0x') && artifact.bytecode.length > 200, 'bytecode present');
  console.log('[1] artifact OK —', artifact.bytecode.length / 2 - 1, 'bytes, compiler', artifact.compiler);

  // 2. ABI exposes the functions the service relies on
  const iface = new ethers.Interface(artifact.abi);
  for (const fn of ['batchMint', 'sweep721', 'sweep1155', 'withdraw', 'exec', 'owner']) {
    assert.ok(iface.getFunction(fn), `ABI has ${fn}`);
  }
  console.log('[2] ABI has batchMint/sweep721/sweep1155/withdraw/exec/owner');

  // 3. Calldata encodes correctly (validates parameter types)
  const data = iface.encodeFunctionData('batchMint', [
    '0x000000000000000000000000000000000000dEaD', '0x1234', 1000000000000000n, 5n,
  ]);
  assert.ok(data.startsWith('0x') && data.length > 10, 'batchMint encodes');
  console.log('[3] batchMint calldata encodes:', data.slice(0, 18), '…');

  // 4. ContractFactory accepts abi+bytecode (bytecode/abi compatible)
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode);
  assert.ok(factory.bytecode.length > 200);
  console.log('[4] ContractFactory constructs from artifact');

  // 5. Service exports
  for (const fn of ['deploy', 'batchMint', 'sweep', 'withdraw', 'contractBalance']) {
    assert.strictEqual(typeof delegation[fn], 'function', `service exports ${fn}`);
  }
  console.log('[5] delegation service exports OK');

  console.log('ALL DELEGATION SMOKE TESTS PASSED');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
