'use strict';

const config = require('../config');

async function getContractSource(address) {
  if (!config.etherscanApiKey) return null;
  const params = new URLSearchParams({
    module: 'contract',
    action: 'getsourcecode',
    address: address.toLowerCase(),
    apikey: config.etherscanApiKey,
  });
  const res = await fetch(`https://api.etherscan.io/api?${params}`, {
    signal: AbortSignal.timeout(8000),
  });
  const data = await res.json();
  if (data.status !== '1' || !data.result?.[0]) return null;
  const row = data.result[0];
  return {
    verified: row.SourceCode && row.SourceCode !== '',
    contractName: row.ContractName || '',
    compiler: row.CompilerVersion || '',
  };
}

module.exports = { getContractSource };
