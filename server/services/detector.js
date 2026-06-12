'use strict';

const config = require('../config');
const opensea = require('./opensea');
const etherscan = require('./etherscan');
const phases = require('./phases');
const eligibility = require('./eligibility');

function extractSlug(input) {
  const v = input.trim();
  try {
    if (v.includes('opensea.io')) {
      const u = new URL(v.startsWith('http') ? v : `https://${v}`);
      const parts = u.pathname.split('/').filter(Boolean);
      const i = parts.indexOf('collection');
      if (i >= 0 && parts[i + 1]) return parts[i + 1].split('?')[0];
      if (parts[0] && parts[0] !== 'assets' && parts[0] !== 'item') {
        return parts[0].split('?')[0];
      }
    }
  } catch { /* ignore */ }
  const m = v.match(/opensea\.io\/collection\/([a-zA-Z0-9_-]+)/i);
  return m ? m[1] : null;
}

function extractAddress(input) {
  const m = input.match(/0x[a-fA-F0-9]{40}/);
  return m ? m[0] : null;
}

function detectChainHint(input) {
  const v = input.toLowerCase();
  if (v.includes('base')) return 'base';
  if (v.includes('blast')) return 'blast';
  if (v.includes('polygon')) return 'polygon';
  return 'ethereum';
}

function inferStd(drop) {
  const t = (drop?.drop_type || '').toLowerCase();
  if (t.includes('seadrop')) return { std: 'SeaDrop', stdClass: 'sd' };
  if (t.includes('1155')) return { std: 'ERC-1155', stdClass: '1155' };
  return { std: 'SeaDrop', stdClass: 'sd' };
}

function heuristic(val) {
  const v = val.toLowerCase();
  let std = 'ERC-721A', stdClass = '721', chain = detectChainHint(val);
  if (v.includes('opensea') || v.includes('seadrop')) { std = 'SeaDrop'; stdClass = 'sd'; }
  else if (v.includes('magiceden') || v.includes('magic-eden')) { std = 'ERC-721A'; stdClass = '721'; }
  else if (v.includes('manifold')) { std = 'Manifold'; stdClass = 'mf'; }
  else if (v.includes('thirdweb')) { std = 'Thirdweb'; stdClass = 'tw'; }
  const isUrl = v.includes('http') || v.includes('.io') || v.includes('.xyz') || v.includes('.com');
  const addr = extractAddress(val) || (val.length < 60 ? val : val.substring(0, 20) + '...');
  return {
    name: isUrl ? (val.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') || 'Unknown') : 'Contract',
    addr,
    std, stdClass,
    chain: opensea.displayChain(chain),
    chainSlug: chain,
    price: '—', supply: '—', totalMinted: '—',
    verified: config.openseaApiKey ? '? Unverified' : '? Add OPENSEA_API_KEY to .env',
    source: isUrl ? 'Heuristic (add OpenSea key for live data)' : 'Heuristic',
    phases: phases.fallbackPhases(),
    walletElig: {},
    live: false,
  };
}

async function fetchDropPhases(slug) {
  try {
    const drop = await opensea.getDrop(slug);
    const parsed = phases.parseDropPhases(drop);
    if (parsed?.length) {
      return {
        phases: parsed,
        drop,
        hasDrop: true,
      };
    }
  } catch (e) {
    if (!/not found|404/i.test(e.message)) {
      return { phases: null, drop: null, hasDrop: false, dropError: e.message };
    }
  }
  return { phases: null, drop: null, hasDrop: false };
}

async function enrichWithDrop(slug, base) {
  const { phases: parsed, drop, hasDrop } = await fetchDropPhases(slug);
  if (parsed?.length) {
    base.phases = parsed;
    base.hasDrop = true;
    base.price = phases.pickDisplayPrice(parsed);
    if (drop) {
      const stdInfo = inferStd(drop);
      base.std = stdInfo.std;
      base.stdClass = stdInfo.stdClass;
      if (drop.contract_address) base.addr = drop.contract_address;
      if (drop.chain) {
        base.chainSlug = opensea.chainSlug(drop.chain);
        base.chain = opensea.displayChain(base.chainSlug);
      }
      if (drop.max_supply != null) base.supply = String(drop.max_supply);
      if (drop.total_supply != null) base.totalMinted = String(drop.total_supply);
      base.isMinting = !!drop.is_minting;
      base.activeStageUuid = drop.active_stage?.uuid || null;
    }
  } else if (!base.phases?.length) {
    base.phases = phases.fallbackPhases(base.price !== '—' ? base.price : 'check OpenSea');
  }
  base.openseaSlug = slug;
  return base;
}

async function fromCollection(slug) {
  const [col, stats, dropInfo] = await Promise.all([
    opensea.getCollection(slug),
    opensea.getCollectionStats(slug).catch(() => null),
    fetchDropPhases(slug),
  ]);

  const contracts = col.contracts || [];
  const primary = contracts[0];
  const addr = dropInfo.drop?.contract_address || primary?.address || col.primary_asset_contracts?.[0] || '0x…';
  const chainSlug = dropInfo.drop?.chain
    ? opensea.chainSlug(dropInfo.drop.chain)
    : (primary?.chain || 'ethereum');

  let verified = '✓ OpenSea listed';
  if (extractAddress(addr)) {
    const es = await etherscan.getContractSource(addr);
    if (es?.verified) verified = `✓ Verified · ${es.contractName || 'Etherscan'}`;
    else if (config.etherscanApiKey) verified = '? On Etherscan — unverified';
  }

  const floor = stats?.total?.floor_price ?? col.floor_price;
  const floorPrice = floor != null ? `${floor} ETH` : '—';
  const supply = dropInfo.drop?.max_supply ?? (col.total_supply != null ? String(col.total_supply) : '—');
  const totalMinted = dropInfo.drop?.total_supply
    ?? (stats?.total?.num_owners != null ? String(stats.total.num_owners) : '—');

  const stdInfo = dropInfo.drop ? inferStd(dropInfo.drop) : { std: 'SeaDrop', stdClass: 'sd' };
  const parsedPhases = dropInfo.phases?.length
    ? dropInfo.phases
    : phases.fallbackPhases(floorPrice !== '—' ? floorPrice : 'price TBC');

  const result = {
    name: col.name || dropInfo.drop?.collection_name || slug,
    addr,
    std: stdInfo.std,
    stdClass: stdInfo.stdClass,
    chain: opensea.displayChain(chainSlug),
    chainSlug,
    price: dropInfo.phases?.length ? phases.pickDisplayPrice(dropInfo.phases) : floorPrice,
    supply: String(supply),
    totalMinted: String(totalMinted),
    verified,
    source: dropInfo.hasDrop ? 'OpenSea API v2 · Drop stages' : 'OpenSea API v2',
    phases: parsedPhases,
    walletElig: {},
    live: true,
    openseaSlug: slug,
    hasDrop: dropInfo.hasDrop,
    isMinting: !!dropInfo.drop?.is_minting,
    activeStageUuid: dropInfo.drop?.active_stage?.uuid || null,
    imageUrl: col.image_url || dropInfo.drop?.image_url || null,
  };

  return result;
}

async function fromContract(address, chainHint) {
  const chainSlug = opensea.chainSlug(chainHint);
  const data = await opensea.getContract(chainSlug, address);
  const col = data.collection || data;
  const slug = typeof col === 'string' ? col : (col?.collection || col?.slug || null);
  const name = data.name || col?.name || 'Contract';

  let verified = '✓ OpenSea indexed';
  const es = await etherscan.getContractSource(address);
  if (es?.verified) verified = `✓ Verified · ${es.contractName || 'Etherscan'}`;

  const result = {
    name,
    addr: address,
    std: 'SeaDrop',
    stdClass: 'sd',
    chain: opensea.displayChain(chainSlug),
    chainSlug,
    price: '—',
    supply: '—',
    totalMinted: '—',
    verified,
    source: 'OpenSea API v2 + on-chain',
    phases: phases.fallbackPhases('check OpenSea'),
    walletElig: {},
    live: true,
    openseaSlug: slug,
    hasDrop: false,
  };

  if (slug) return enrichWithDrop(slug, result);
  return result;
}

async function detect(input, options = {}) {
  if (!input || input.length > 500) throw new Error('Invalid input');
  const slug = extractSlug(input);
  const address = extractAddress(input);
  const chainHint = detectChainHint(input);

  let result;
  if (config.openseaApiKey) {
    if (slug) {
      try { result = await fromCollection(slug); } catch (e) { /* fall through */ }
    }
    if (!result && address) {
      try { result = await fromContract(address, chainHint); } catch (e) { /* fall through */ }
    }
  }

  if (!result) {
    result = heuristic(input);
    if (!config.openseaApiKey) {
      result.verified = '⚠ Set OPENSEA_API_KEY in .env for live detection';
    }
  }

  if (options.wallets?.length && result.openseaSlug && result.phases?.length) {
    const targetPhase = result.phases.find(p => p.status === 'live')
      || result.phases.find(p => p.status === 'scheduled')
      || result.phases[0];
    if (targetPhase) {
      try {
        const elig = await eligibility.checkWalletsForPhase(
          result.openseaSlug,
          targetPhase,
          options.wallets,
        );
        result.walletElig = { [targetPhase.uuid || '0']: elig.wallets };
        result.eligibilitySummary = elig.summary;
        result.eligibilityPhaseUuid = targetPhase.uuid;
      } catch { /* optional */ }
    }
  }

  return result;
}

module.exports = {
  detect,
  extractSlug,
  extractAddress,
  fetchDropPhases,
};
