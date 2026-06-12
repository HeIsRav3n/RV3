'use strict';

const { ethers } = require('ethers');

const TYPE_LABELS = {
  public: 'Public',
  allowlist: 'Allowlist',
  gtd: 'GTD',
  presale: 'Presale',
};

function weiToEth(weiStr) {
  try {
    return parseFloat(ethers.formatEther(BigInt(weiStr || '0')));
  } catch {
    return 0;
  }
}

function formatPrice(priceEth) {
  if (!priceEth || priceEth === 0) return 'FREE';
  if (priceEth < 0.0001) return `${priceEth.toFixed(6)} ETH`;
  if (priceEth < 1) return `${priceEth.toFixed(4)} ETH`;
  return `${priceEth.toFixed(3)} ETH`;
}

function classifyStageType(stage) {
  const label = (stage.label || '').toLowerCase();
  const apiType = stage.stage_type || '';

  if (apiType === 'public_sale') return 'public';

  if (/\bgtd\b/.test(label)) return 'gtd';
  if (/guaranteed|guarantee/.test(label) && !/not guaranteed|non-guaranteed|non guaranteed/.test(label)) return 'gtd';
  if (/allowlist|whitelist|\bwl\b|presale|pre-sale|fcfs|friends|collectors|team|vip|og|early/.test(label)) {
    return 'allowlist';
  }
  if (apiType === 'signed_presale') return 'allowlist';
  return 'presale';
}

function phaseStatus(startMs, endMs, now = Date.now()) {
  if (now >= startMs && now <= endMs) return 'live';
  if (now > endMs) return 'ended';
  return 'scheduled';
}

function buildPhaseLabel(stage, type, priceEth) {
  const name = (stage.label || TYPE_LABELS[type] || 'Phase').trim();
  const typeTag = TYPE_LABELS[type] || type;
  const showType = !name.toLowerCase().includes(typeTag.toLowerCase());
  const prefix = showType ? `${typeTag} · ` : '';
  return `${prefix}${name} · ${formatPrice(priceEth)}`;
}

function parseStage(stage, now = Date.now()) {
  const startMs = new Date(stage.start_time).getTime();
  const endMs = new Date(stage.end_time).getTime();
  const type = classifyStageType(stage);
  const priceEth = weiToEth(stage.price);
  const status = phaseStatus(startMs, endMs, now);

  return {
    uuid: stage.uuid,
    type,
    stageType: stage.stage_type,
    label: buildPhaseLabel(stage, type, priceEth),
    status,
    openTimestamp: startMs,
    closeTimestamp: endMs,
    priceEth,
    priceWei: stage.price || '0',
    maxPerWallet: parseInt(stage.max_per_wallet || '0', 10) || null,
    requiresAllowlist: stage.stage_type === 'signed_presale',
  };
}

function parseDropPhases(drop) {
  if (!drop?.stages?.length) return null;

  const now = Date.now();
  const phases = [...drop.stages]
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
    .map(s => parseStage(s, now));

  return phases;
}

function fallbackPhases(priceLabel = 'price TBC') {
  return [{
    uuid: null,
    type: 'public',
    stageType: 'public_sale',
    label: `Public · ${priceLabel}`,
    status: 'scheduled',
    openTimestamp: Date.now() + 7200000,
    closeTimestamp: null,
    priceEth: 0,
    priceWei: '0',
    maxPerWallet: null,
    requiresAllowlist: false,
  }];
}

function pickDisplayPrice(phases) {
  const live = phases.find(p => p.status === 'live');
  if (live) return formatPrice(live.priceEth);
  const next = phases.find(p => p.status === 'scheduled');
  if (next) return formatPrice(next.priceEth);
  const last = phases[phases.length - 1];
  return last ? formatPrice(last.priceEth) : '—';
}

module.exports = {
  parseDropPhases,
  parseStage,
  fallbackPhases,
  pickDisplayPrice,
  classifyStageType,
  formatPrice,
  weiToEth,
};
