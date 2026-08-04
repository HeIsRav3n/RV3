'use strict';

const { ethers } = require('ethers');
const opensea = require('./opensea');
const blockscout = require('./blockscout');
const rpc = require('./rpc');
const tx = require('./tx');
const { decrypt } = require('./crypto');

const ERC721_IFACE = new ethers.Interface([
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
]);
const ERC1155_IFACE = new ethers.Interface([
  'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)',
]);

// Normalized NFT discovery: Blockscout for chains OpenSea does not index
// (Robinhood), OpenSea for everything else.
// Returns [{ contract, tokenId, std, collection }]
async function getNftsForWallet(address, chain, collectionFilter) {
  const slug = rpc.normalizeChain(chain);
  let nfts;
  if (blockscout.supportsChain(slug)) {
    nfts = await blockscout.getAccountNfts(slug, address, 100);
  } else {
    const raw = await opensea.getAccountNfts(slug, address, 100);
    nfts = raw.map(n => ({
      contract: String(n.contract || n.nft?.contract || '').toLowerCase(),
      tokenId: n.identifier ?? n.token_id ?? n.tokenId,
      std: String(n.token_standard || 'erc721').toUpperCase().includes('1155') ? 'ERC-1155' : 'ERC-721',
      collection: String(n.collection || '').toLowerCase(),
    })).filter(n => n.contract && n.tokenId != null);
  }
  if (!collectionFilter) return nfts;
  const f = collectionFilter.toLowerCase();
  return nfts.filter(n =>
    n.contract === f || (n.collection || '').includes(f.replace(/.*\//, '')));
}

async function transferNft(signer, nft, from, to, opts, log, name) {
  const { gasGwei, chain, rpcUrls, readUrl } = opts;
  const is1155 = /1155/.test(nft.std || '');
  const data = is1155
    ? ERC1155_IFACE.encodeFunctionData('safeTransferFrom', [from, to, BigInt(nft.tokenId), 1n, '0x'])
    : ERC721_IFACE.encodeFunctionData('safeTransferFrom', [from, to, BigInt(nft.tokenId)]);

  // Dynamic gas — Arbitrum-stack L2s (Robinhood) fold L1 calldata into gas
  // used, so a mainnet-sized fixed limit would fail there.
  let gasLimit = 150000n;
  try {
    const est = await rpc.estimateGas(readUrl, { from, to: nft.contract, data, value: 0n });
    gasLimit = (est * 13n) / 10n;
    if (gasLimit < 120000n) gasLimit = 120000n;
    if (gasLimit > 3000000n) gasLimit = 3000000n;
  } catch { /* keep default — sendTx simulate still catches hard reverts */ }

  const { hash } = await tx.sendTx(signer, {
    to: nft.contract,
    data,
    value: 0n,
    gasLimit,
  }, { gasGwei, chainSlug: chain, rpcUrls, blast: false, wait: true });
  log('ok', `${name} transferred token ${nft.tokenId} · ${hash.slice(0, 14)}…`);
  return hash;
}

async function runSweepOp(op, wallets, log) {
  const hub = wallets.find(w => w.id === op.hubId);
  if (!hub?.address) throw new Error('Hub wallet not found');
  const chain = rpc.normalizeChain(op.chain || 'ethereum');
  const sources = wallets.filter(w =>
    op.sourceIds.includes(w.id) && w.encryptedKey && w.id !== hub.id);
  if (!sources.length) {
    throw new Error('No source wallets with server keys — the hub cannot be its own source; pick at least one other wallet that was imported with its private key');
  }

  const extraRpcs = op.rpcUrls || [];
  const urls = tx.pickSendUrls('DIRECT RPC', extraRpcs, chain);
  if (!urls.length) throw new Error(`No RPC endpoints configured for ${chain}`);
  const readUrl = await rpc.getFastestUrl(urls);
  const provider = new ethers.JsonRpcProvider(readUrl);
  const gasGwei = op.gasGwei || tx.GAS_PRESETS.normal;
  const txHashes = [];
  const reasons = [];
  let transferred = 0;

  log('info', `Sweep on ${chain} · ${sources.length} source(s) → ${hub.name || hub.address.slice(0, 10)}`);

  for (const src of sources) {
    const signer = new ethers.Wallet(decrypt(src.encryptedKey), provider);
    let nfts;
    try {
      nfts = await getNftsForWallet(src.address, chain, op.collection);
    } catch (e) {
      log('warn', `${src.name} NFT fetch failed: ${e.message}`);
      reasons.push(`${src.name}: NFT lookup failed (${e.message.slice(0, 80)})`);
      continue;
    }
    if (!nfts.length) {
      log('info', `${src.name} no NFTs to sweep on ${chain}`);
      reasons.push(`${src.name}: no NFTs found on ${chain}${op.collection ? ' matching filter' : ''}`);
      continue;
    }
    log('info', `${src.name} sweeping ${nfts.length} NFT(s)`);
    for (const nft of nfts.slice(0, 20)) {
      try {
        const hash = await transferNft(
          signer, nft, src.address, hub.address,
          { gasGwei, chain, rpcUrls: extraRpcs, readUrl }, log, src.name
        );
        txHashes.push(hash);
        transferred++;
      } catch (e) {
        log('err', `${src.name} transfer fail: ${e.message}`);
        reasons.push(`${src.name} #${nft.tokenId}: ${e.message.slice(0, 80)}`);
      }
    }
  }

  return { txHashes, transferred, reasons };
}

module.exports = { runSweepOp, getNftsForWallet };
