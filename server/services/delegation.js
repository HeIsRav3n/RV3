'use strict';

/**
 * Delegation batch minting — the on-chain "mint many in one transaction" route.
 * Deploys an owner-gated RV3BatchMinter per operator wallet, then drives it:
 *   batchMint  — fire the drop's mint calldata `count` times in one tx
 *   sweep      — auto-discover NFTs the contract now holds and transfer them out
 *   withdraw   — pull leftover ETH back to the operator
 */

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const rpc = require('./rpc');
const tx = require('./tx');
const opensea = require('./opensea');
const sweepSvc = require('./sweep');
const { decrypt } = require('./crypto');

const ARTIFACT = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '..', 'contracts', 'artifacts', 'RV3BatchMinter.json'), 'utf8'));

const ABI = ARTIFACT.abi;
const BYTECODE = ARTIFACT.bytecode;

function signerFor(walletEntry, provider) {
  if (!walletEntry?.encryptedKey) {
    throw new Error('Operator wallet has no server key — re-import it with its private key');
  }
  return new ethers.Wallet(decrypt(walletEntry.encryptedKey), provider);
}

async function connect(chain, extraRpcs = []) {
  const c = rpc.normalizeChain(chain);
  const urls = tx.pickSendUrls('DIRECT RPC', extraRpcs, c);
  if (!urls.length) throw new Error(`No RPC configured for ${c}`);
  const url = await rpc.getFastestUrl(urls);
  return { chain: c, url, provider: new ethers.JsonRpcProvider(url) };
}

// EIP-1559 fee overrides derived from the current base fee + user's gas preset.
// Falls back to letting ethers auto-populate on non-1559 chains.
async function feeOverrides(url, from, gasGwei) {
  try {
    const { baseFeeGwei } = await rpc.getWalletNonceAndChain(url, from);
    if (baseFeeGwei == null) return {};
    const tip = Math.min(Math.max(gasGwei * 0.12, 1), 2.5);
    const maxFee = Math.max(baseFeeGwei * 1.25 + tip, gasGwei);
    return {
      maxFeePerGas: ethers.parseUnits(maxFee.toFixed(4), 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits(tip.toFixed(4), 'gwei'),
    };
  } catch {
    return {};
  }
}

async function deploy({ ownerWallet, chain = 'ethereum', rpcUrls = [], gasGwei = 7, log = () => {} }) {
  const { chain: c, url, provider } = await connect(chain, rpcUrls);
  const signer = signerFor(ownerWallet, provider);
  const fees = await feeOverrides(url, ownerWallet.address, gasGwei);

  log('info', `Deploying RV3BatchMinter on ${c} from ${ownerWallet.name || ownerWallet.address}`);
  const factory = new ethers.ContractFactory(ABI, BYTECODE, signer);
  const contract = await factory.deploy(fees);
  const dep = contract.deploymentTransaction();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  log('ok', `Deployed RV3BatchMinter at ${address} · tx ${dep.hash.slice(0, 14)}…`);

  return {
    id: `deploy_${Date.now()}`,
    address,
    chain: c,
    owner: ownerWallet.address,
    ownerId: ownerWallet.id,
    txHash: dep.hash,
    deployedAt: new Date().toISOString(),
  };
}

/**
 * Fire the drop's mint calldata `count` times in one transaction. The operator
 * funds the whole batch via msg.value (mint cost x count), so no separate
 * pre-funding step is required. Returns tx hash + how many mints succeeded.
 */
async function batchMint({ deployment, ownerWallet, openseaSlug, qty = 1, count, gasGwei = 7, rpcUrls = [], log = () => {} }) {
  if (!count || count < 1) throw new Error('count must be >= 1');
  const { chain, url, provider } = await connect(deployment.chain, rpcUrls);
  const signer = signerFor(ownerWallet, provider);

  // Build mint calldata with the CONTRACT as the minter/recipient.
  const mintTx = await opensea.buildDropMintTransaction(openseaSlug, deployment.address, qty);
  const valueEach = BigInt(mintTx.value || 0n);
  const totalValue = valueEach * BigInt(count);

  const gasCostBuffer = ethers.parseEther('0.02');
  const bal = await provider.getBalance(ownerWallet.address);
  if (bal < totalValue + gasCostBuffer) {
    throw new Error(`Operator needs ~${ethers.formatEther(totalValue + gasCostBuffer)} ETH (${count}× mint + gas), has ${ethers.formatEther(bal)}`);
  }

  const contract = new ethers.Contract(deployment.address, ABI, signer);
  const fees = await feeOverrides(url, ownerWallet.address, gasGwei);

  let gasLimit;
  try {
    const est = await contract.batchMint.estimateGas(
      mintTx.to, mintTx.data, valueEach, count, { value: totalValue });
    gasLimit = (est * 12n) / 10n;
  } catch (e) {
    throw new Error(`preflight revert: ${(e.shortMessage || e.reason || e.message || 'reverted').slice(0, 120)}`);
  }

  log('info', `batchMint ${count}× on ${chain} · ${ethers.formatEther(totalValue)} ETH total · gas ${gasLimit}`);
  const resp = await contract.batchMint(
    mintTx.to, mintTx.data, valueEach, count, { value: totalValue, gasLimit, ...fees });
  log('ok', `batchMint sent · tx ${resp.hash.slice(0, 14)}…`);
  const receipt = await resp.wait(1);
  if (!receipt || receipt.status === 0) throw new Error('batchMint reverted on-chain');

  // Parse the BatchMinted event for the succeeded count.
  let succeeded = null;
  for (const lg of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(lg);
      if (parsed?.name === 'BatchMinted') { succeeded = Number(parsed.args.succeeded); break; }
    } catch { /* not our event */ }
  }
  log('ok', `batchMint confirmed in block ${receipt.blockNumber} · ${succeeded ?? '?'}/${count} succeeded`);

  return {
    txHash: resp.hash,
    block: receipt.blockNumber,
    succeeded: succeeded ?? count,
    requested: count,
    tokensMinted: (succeeded ?? count) * qty,
    gasUsed: receipt.gasUsed?.toString() || null,
  };
}

/**
 * Discover every NFT the contract now holds (via the same chain-aware source as
 * NFT Sweep) and transfer them out to `to` using the contract's owner-gated
 * sweep functions. Batches per collection.
 */
async function sweep({ deployment, ownerWallet, to, rpcUrls = [], gasGwei = 7, log = () => {} }) {
  const { chain, url, provider } = await connect(deployment.chain, rpcUrls);
  const dest = to || ownerWallet.address;
  const signer = signerFor(ownerWallet, provider);
  const contract = new ethers.Contract(deployment.address, ABI, signer);
  const fees = await feeOverrides(url, ownerWallet.address, gasGwei);

  const nfts = await sweepSvc.getNftsForWallet(deployment.address, chain);
  if (!nfts.length) { log('info', 'Nothing to sweep — contract holds no NFTs'); return { swept: 0, txHashes: [] }; }

  const byCollection = new Map();
  for (const n of nfts) {
    const key = `${n.contract}|${/1155/.test(n.std || '') ? '1155' : '721'}`;
    if (!byCollection.has(key)) byCollection.set(key, []);
    byCollection.get(key).push(n);
  }

  const txHashes = [];
  let swept = 0;
  for (const [key, items] of byCollection) {
    const [collection, std] = key.split('|');
    const ids = items.map(i => BigInt(i.tokenId));
    try {
      let resp;
      if (std === '1155') {
        resp = await contract.sweep1155(collection, ids, ids.map(() => 1n), dest, fees);
      } else {
        resp = await contract.sweep721(collection, ids, dest, fees);
      }
      await resp.wait(1);
      txHashes.push(resp.hash);
      swept += items.length;
      log('ok', `Swept ${items.length} token(s) from ${collection.slice(0, 10)}… → ${dest.slice(0, 10)}…`);
    } catch (e) {
      log('err', `Sweep ${collection.slice(0, 10)}… failed: ${(e.shortMessage || e.message || '').slice(0, 90)}`);
    }
  }
  return { swept, txHashes };
}

async function withdraw({ deployment, ownerWallet, to, rpcUrls = [], gasGwei = 7, log = () => {} }) {
  const { url, provider } = await connect(deployment.chain, rpcUrls);
  const dest = to || ownerWallet.address;
  const signer = signerFor(ownerWallet, provider);
  const contract = new ethers.Contract(deployment.address, ABI, signer);
  const bal = await provider.getBalance(deployment.address);
  if (bal === 0n) { log('info', 'Contract balance is 0 — nothing to withdraw'); return { withdrawn: '0', txHash: null }; }
  const fees = await feeOverrides(url, ownerWallet.address, gasGwei);
  const resp = await contract.withdraw(dest, fees);
  await resp.wait(1);
  log('ok', `Withdrew ${ethers.formatEther(bal)} ETH → ${dest.slice(0, 10)}… · tx ${resp.hash.slice(0, 14)}…`);
  return { withdrawn: ethers.formatEther(bal), txHash: resp.hash };
}

// Live on-chain balance of a deployed contract (for the UI).
async function contractBalance(deployment, rpcUrls = []) {
  const { url } = await connect(deployment.chain, rpcUrls);
  return rpc.getBalance(url, deployment.address);
}

module.exports = { deploy, batchMint, sweep, withdraw, contractBalance, ABI };
