'use strict';

const opensea = require('./opensea');

const CONCURRENCY = 8;

async function mapPool(items, fn, limit = CONCURRENCY) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function parseMintError(message) {
  const msg = String(message || '').toLowerCase();
  if (/allowlist|whitelist|not eligible|not on|no proof|merkle|signed/.test(msg)) {
    return { eligible: false, reason: 'Not on allowlist' };
  }
  if (/fully minted|sold out|supply/.test(msg)) {
    return { eligible: false, reason: 'Sold out' };
  }
  if (/not currently active|not active|drop is not/.test(msg)) {
    return { eligible: false, reason: 'Phase not active' };
  }
  if (/insufficient|balance/.test(msg)) {
    return { eligible: true, reason: 'Eligible (low balance on server)' };
  }
  if (/trading operations|restricted|sanctioned|blocked/.test(msg)) {
    return { eligible: false, reason: 'Wallet restricted' };
  }
  return { eligible: false, reason: message.slice(0, 100) };
}

async function probeMint(slug, address) {
  try {
    await opensea.buildDropMintTransaction(slug, address, 1, 8000);
    return { eligible: true, reason: 'Eligible' };
  } catch (e) {
    return parseMintError(e.message);
  }
}

async function checkWalletForPhase(slug, phase, address, dropCache) {
  const addr = address.toLowerCase();

  if (phase.status === 'ended') {
    return { address: addr, eligible: false, reason: 'Phase ended' };
  }

  if (phase.status === 'scheduled') {
    if (phase.type === 'public' || !phase.requiresAllowlist) {
      return { address: addr, eligible: true, reason: 'Opens at phase start' };
    }
    return { address: addr, eligible: null, reason: 'Allowlist — verify at go-live' };
  }

  // Live phase
  if (phase.type === 'public' && !phase.requiresAllowlist) {
    return { address: addr, eligible: true, reason: 'Public mint open' };
  }

  let drop = dropCache?.data;
  if (!drop) {
    drop = await opensea.getDrop(slug);
    if (dropCache) dropCache.data = drop;
  }

  const activeUuid = drop.active_stage?.uuid;
  if (phase.uuid && activeUuid && phase.uuid !== activeUuid) {
    const activeLabel = drop.active_stage?.label || 'another stage';
    return { address: addr, eligible: false, reason: `Active stage: ${activeLabel}` };
  }

  const result = await probeMint(slug, addr);
  if (result.eligible && phase.uuid && activeUuid && phase.uuid === activeUuid) {
    return { address: addr, eligible: true, reason: 'Eligible for this phase' };
  }
  if (result.eligible && !phase.requiresAllowlist) {
    return { address: addr, eligible: true, reason: result.reason };
  }
  if (result.eligible && phase.requiresAllowlist) {
    return { address: addr, eligible: true, reason: 'Eligible for allowlist' };
  }
  return { address: addr, ...result };
}

async function checkWalletsForPhase(slug, phase, wallets) {
  if (!slug || !phase) throw new Error('slug and phase required');
  const dropCache = { data: null };

  const entries = wallets.map(w => ({
    id: w.id,
    address: (w.address || w.addr || '').toLowerCase(),
  })).filter(w => /^0x[a-f0-9]{40}$/.test(w.address));

  const checked = await mapPool(entries, async (w) => {
    const r = await checkWalletForPhase(slug, phase, w.address, dropCache);
    return { walletId: w.id, ...r };
  });

  const byWallet = {};
  const byPhase = {};
  for (const r of checked) {
    byWallet[r.walletId] = {
      eligible: r.eligible,
      reason: r.reason,
      address: r.address,
    };
    byPhase[r.address] = { eligible: r.eligible, reason: r.reason };
  }

  const eligible = checked.filter(r => r.eligible === true).length;
  const ineligible = checked.filter(r => r.eligible === false).length;
  const pending = checked.filter(r => r.eligible === null).length;

  return {
    phaseUuid: phase.uuid,
    phaseType: phase.type,
    phaseStatus: phase.status,
    summary: { total: checked.length, eligible, ineligible, pending },
    wallets: byWallet,
    byAddress: byPhase,
  };
}

async function checkWalletsAllPhases(slug, phases, wallets) {
  const walletElig = {};
  for (const phase of phases) {
    const key = phase.uuid || `idx_${phases.indexOf(phase)}`;
    const r = await checkWalletsForPhase(slug, phase, wallets);
    walletElig[key] = r.wallets;
  }
  return walletElig;
}

module.exports = {
  checkWalletForPhase,
  checkWalletsForPhase,
  checkWalletsAllPhases,
  probeMint,
};
