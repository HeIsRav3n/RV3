'use strict';
// Compiles contracts/*.sol → contracts/artifacts/<Name>.json (abi + bytecode).
// Run: npm run compile:contracts   (requires the `solc` devDependency)
// The produced artifact is committed so the runtime never needs a compiler.

const fs = require('fs');
const path = require('path');
const solc = require('solc');

const CONTRACT_DIR = path.join(__dirname, '..', 'contracts');
const OUT_DIR = path.join(CONTRACT_DIR, 'artifacts');
const SOURCES = ['RV3BatchMinter.sol'];

function compileFile(file) {
  const source = fs.readFileSync(path.join(CONTRACT_DIR, file), 'utf8');
  const input = {
    language: 'Solidity',
    sources: { [file]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (out.errors || []).filter(e => e.severity === 'error');
  if (errors.length) {
    for (const e of errors) console.error(e.formattedMessage);
    throw new Error(`solc failed for ${file}`);
  }
  for (const w of (out.errors || [])) console.warn(w.formattedMessage);
  return out.contracts[file];
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const file of SOURCES) {
  const compiled = compileFile(file);
  for (const [name, c] of Object.entries(compiled)) {
    if (!c.evm.bytecode.object) continue; // skip interfaces / abstract contracts
    const artifact = {
      contractName: name,
      compiler: solc.version(),
      abi: c.abi,
      bytecode: '0x' + c.evm.bytecode.object,
      compiledAt: new Date().toISOString(),
    };
    const outPath = path.join(OUT_DIR, `${name}.json`);
    fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2));
    console.log(`✓ ${name} → ${path.relative(process.cwd(), outPath)} (${artifact.bytecode.length / 2 - 1} bytes)`);
  }
}
console.log('done');
