'use strict';

const { ethers } = require('ethers');
const opensea = require('./opensea');
const tx = require('./tx');
const { decrypt } = require('./crypto');

const ERC721_ABI = [
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  'function transferFrom(address from, address to, uint256 tokenId)',
];

async function getNftsForWallet(address, chain, collectionFilter) {
  const nfts = await opensea.getAccountNfts(chain, address, 100);
  if (!collectionFilter) return nfts;
  const f = collectionFilter.toLowerCase();
  return nfts.filter(n => {
    const contract = (n.contract || n.nft?.contract || '').toLowerCase();
    const slug = (n.collection || '').toLowerCase();
    return contract === f || slug.includes(f.replace(/.*\//, ''));
  });
}

async function transferNft(signer, contract, from, to, tokenId, gasGwei, log, name) {
  const iface = new ethers.Interface(ERC721_ABI);
  const data = iface.encodeFunctionData('safeTransferFrom', [from, to, BigInt(tokenId)]);
  const { hash } = await tx.sendTx(signer, {
    to: contract,
    data,
    value: 0n,
    gasLimit: 120000n,
  }, { gasGwei, blast: false, wait: true });
  log('ok', `${name} transferred token ${tokenId} · ${hash.slice(0, 14)}…`);
  return hash;
}

async function runSweepOp(op, wallets, log) {
  const hub = wallets.find(w => w.id === op.hubId);
  if (!hub?.address) throw new Error('Hub wallet not found');
  const sources = wallets.filter(w => op.sourceIds.includes(w.id) && w.encryptedKey);
  if (!sources.length) throw new Error('No source wallets with server keys');

  const urls = tx.pickSendUrls('DIRECT RPC', op.rpcUrls || []);
  const provider = new ethers.JsonRpcProvider(urls[0]);
  const gasGwei = op.gasGwei || tx.GAS_PRESETS.normal;
  const chain = op.chain || 'ethereum';
  const txHashes = [];
  let transferred = 0;

  for (const src of sources) {
    if (src.id === hub.id) continue;
    const signer = new ethers.Wallet(decrypt(src.encryptedKey), provider);
    let nfts;
    try {
      nfts = await getNftsForWallet(src.address, chain, op.collection);
    } catch (e) {
      log('warn', `${src.name} NFT fetch failed: ${e.message}`);
      continue;
    }
    if (!nfts.length) {
      log('info', `${src.name} no NFTs to sweep`);
      continue;
    }
    log('info', `${src.name} sweeping ${nfts.length} NFT(s)`);
    for (const nft of nfts.slice(0, 20)) {
      try {
        const contract = nft.contract || nft.nft?.contract;
        const tokenId = nft.identifier || nft.token_id || nft.tokenId;
        if (!contract || tokenId == null) continue;
        const hash = await transferNft(signer, contract, src.address, hub.address, tokenId, gasGwei, log, src.name);
        txHashes.push(hash);
        transferred++;
      } catch (e) {
        log('err', `${src.name} transfer fail: ${e.message}`);
      }
    }
  }

  return { txHashes, transferred };
}

module.exports = { runSweepOp, getNftsForWallet };
