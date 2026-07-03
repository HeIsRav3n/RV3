'use strict';

/**
 * OpenSea GQL client — gql.opensea.io/graphql (HTTP/2, browser UA).
 * Used alongside REST for speed: GQL lets us batch drop info + stages in
 * one round-trip instead of 2-3 separate REST calls.
 */

const GQL_URL = 'https://gql.opensea.io/graphql';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

const reqCache = new Map(); // dedup in-flight identical requests

async function gqlFetch(query, variables = {}, opts = {}) {
  const { timeout = 8000, apiKey } = opts;

  const body = JSON.stringify({ query, variables });
  const cacheKey = body;

  // Dedup identical concurrent requests (prewarm + detect racing)
  if (reqCache.has(cacheKey)) return reqCache.get(cacheKey);

  const p = (async () => {
    const res = await fetch(GQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Origin': 'https://opensea.io',
        'Referer': 'https://opensea.io/',
        'x-app-id': 'os2-web',
        'User-Agent': UA,
        'Connection': 'keep-alive',
        ...(apiKey ? { 'X-API-KEY': apiKey } : {}),
      },
      body,
      signal: AbortSignal.timeout(timeout),
    });

    const json = await res.json();
    if (!res.ok) throw new Error(`OpenSea GQL ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
    if (json.errors?.length) throw new Error(`GQL: ${json.errors[0].message}`);
    return json.data;
  })();

  reqCache.set(cacheKey, p);
  p.finally(() => reqCache.delete(cacheKey));
  return p;
}

// ── Probe ────────────────────────────────────────────────────────────────────

const PROBE_QUERY = 'query RV3Probe { node(id: "V2ViM0Nvbm5lY3Rpb25UeXBlOjE=") { id } }';

async function probe(timeout = 6000) {
  const start = Date.now();
  await gqlFetch(PROBE_QUERY, {}, { timeout });
  return Date.now() - start;
}

async function probeStats(n = 5) {
  const results = [];
  for (let i = 0; i < n; i++) {
    const start = Date.now();
    try {
      await probe(6000);
      results.push({ ms: Date.now() - start, ok: true });
    } catch (e) {
      results.push({ ms: Date.now() - start, ok: false, error: e.message });
    }
  }
  const ok = results.filter(r => r.ok).map(r => r.ms).sort((a, b) => a - b);
  return {
    target: GQL_URL,
    n,
    ok: ok.length,
    avg: ok.length ? Math.round(ok.reduce((a, b) => a + b, 0) / ok.length) : null,
    min: ok[0] ?? null,
    max: ok[ok.length - 1] ?? null,
    p50: ok[Math.floor(ok.length / 2)] ?? null,
    warm: ok.length > 1 ? Math.round(ok.slice(1).reduce((a, b) => a + b, 0) / (ok.length - 1)) : null,
    results,
  };
}

// ── Drop info ─────────────────────────────────────────────────────────────────

const DROP_QUERY = `
query RV3DropQuery($dropSlug: String!) {
  drop(dropSlug: $dropSlug) {
    ... on Drop {
      slug
      name
      description
      imageUrl
      maxSupply
      totalSupply
      isMinting
      contract { address chain }
      stages {
        uuid
        name
        startTime
        endTime
        price { value unit }
        stageType
        maxQuantityPerTransaction
        maxSupplyPerWallet
        isPublic
      }
    }
  }
}`;

async function getDropInfo(slug, opts = {}) {
  const data = await gqlFetch(DROP_QUERY, { dropSlug: slug }, { timeout: 7000, ...opts });
  const drop = data?.drop;
  if (!drop) return null;
  // Normalize to match REST /drops/{slug} shape so phases.parseDropPhases works
  return normalizeGqlDrop(drop, slug);
}

function normalizeGqlDrop(d, slug) {
  return {
    collection_slug: slug,
    collection_name: d.name,
    image_url: d.imageUrl,
    max_supply: d.maxSupply,
    total_supply: d.totalSupply,
    is_minting: d.isMinting,
    contract_address: d.contract?.address,
    chain: d.contract?.chain,
    stages: (d.stages || []).map(s => ({
      uuid: s.uuid,
      label: s.name || '',
      start_time: s.startTime,
      end_time: s.endTime,
      price: s.price?.unit === 'ETHER'
        ? String(Math.round(parseFloat(s.price.value || 0) * 1e18))
        : '0',
      stage_type: normalizeStageType(s.stageType, s.isPublic),
      max_per_wallet: s.maxSupplyPerWallet != null ? String(s.maxSupplyPerWallet) : '0',
    })),
    _source: 'gql',
  };
}

function normalizeStageType(gqlType, isPublic) {
  if (!gqlType) return isPublic ? 'public_sale' : 'signed_presale';
  const t = gqlType.toLowerCase();
  if (t.includes('public')) return 'public_sale';
  if (t.includes('presale') || t.includes('allowlist') || t.includes('signed')) return 'signed_presale';
  return t;
}

// ── Mint transaction ──────────────────────────────────────────────────────────

const PREPARE_MINT_MUTATION = `
mutation RV3PrepareMint($input: PrepareMintTransactionInput!) {
  prepareMintTransaction(input: $input) {
    transaction {
      chain
      to
      data
      value
    }
  }
}`;

/**
 * Attempt to get SeaDrop calldata via GQL mutation.
 * Returns { to, data, value: BigInt } on success, throws on failure.
 * Callers should fall back to REST if this throws.
 */
async function buildMintTransaction(slug, minterAddress, quantity = 1, opts = {}) {
  const data = await gqlFetch(PREPARE_MINT_MUTATION, {
    input: { dropSlug: slug, minterAddress: minterAddress.toLowerCase(), quantity },
  }, { timeout: 6000, ...opts });

  const tx = data?.prepareMintTransaction?.transaction;
  if (!tx?.to || !tx?.data) throw new Error('GQL mint: unexpected response shape');

  return {
    to: tx.to,
    data: tx.data,
    value: BigInt(tx.value || '0'),
    _source: 'gql',
  };
}

module.exports = {
  gqlFetch,
  probe,
  probeStats,
  getDropInfo,
  buildMintTransaction,
};
