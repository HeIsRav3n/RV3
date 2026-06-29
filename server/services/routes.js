'use strict';

/** Canonical inclusion routes — UI and API must use these keys. */
const ROUTES = {
  DIRECT_RPC: 'direct_rpc',
  PUBLIC: 'public',
  FB_PROTECT: 'fb_protect',
  FB_BUNDLE: 'fb_bundle',
  DELEGATION: 'delegation',
};

const ALIASES = {
  direct: ROUTES.DIRECT_RPC,
  direct_rpc: ROUTES.DIRECT_RPC,
  'direct rpc': ROUTES.DIRECT_RPC,
  public: ROUTES.PUBLIC,
  public_mempool: ROUTES.PUBLIC,
  'public mempool': ROUTES.PUBLIC,
  fb_protect: ROUTES.FB_PROTECT,
  'fb protect': ROUTES.FB_PROTECT,
  flashbots_protect: ROUTES.FB_PROTECT,
  'flashbots protect': ROUTES.FB_PROTECT,
  private: ROUTES.FB_PROTECT,
  fb_bundle: ROUTES.FB_BUNDLE,
  'fb bundle': ROUTES.FB_BUNDLE,
  flashbots_bundle: ROUTES.FB_BUNDLE,
  'flashbots bundle': ROUTES.FB_BUNDLE,
  bundle: ROUTES.FB_BUNDLE,
  delegation: ROUTES.DELEGATION,
  delegation_batch: ROUTES.DELEGATION,
  'delegation batch': ROUTES.DELEGATION,
};

function normalizeRoute(route) {
  const raw = String(route || ROUTES.DIRECT_RPC).trim().toLowerCase().replace(/-/g, '_');
  if (ALIASES[raw]) return ALIASES[raw];
  if (raw.includes('fb_protect') || raw.includes('fb protect') || raw.includes('flashbots protect')) {
    return ROUTES.FB_PROTECT;
  }
  if (raw.includes('fb_bundle') || raw.includes('fb bundle') || raw.includes('flashbots bundle')) {
    return ROUTES.FB_BUNDLE;
  }
  if (raw.includes('delegation')) return ROUTES.DELEGATION;
  if (raw.includes('public')) return ROUTES.PUBLIC;
  return ROUTES.DIRECT_RPC;
}

function isPrivateRoute(route) {
  const r = normalizeRoute(route);
  return r === ROUTES.FB_PROTECT || r === ROUTES.FB_BUNDLE;
}

function isBundleRoute(route) {
  return normalizeRoute(route) === ROUTES.FB_BUNDLE;
}

function displayRoute(route) {
  const map = {
    [ROUTES.DIRECT_RPC]: 'Direct RPC',
    [ROUTES.PUBLIC]: 'Public mempool',
    [ROUTES.FB_PROTECT]: 'Flashbots Protect',
    [ROUTES.FB_BUNDLE]: 'Flashbots bundle',
    [ROUTES.DELEGATION]: 'Delegation batch',
  };
  return map[normalizeRoute(route)] || 'Direct RPC';
}

module.exports = { ROUTES, normalizeRoute, isPrivateRoute, isBundleRoute, displayRoute };
