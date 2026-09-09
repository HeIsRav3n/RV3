// RV3 API client — talks to local Express backend (same origin when using npm start)
const RV3_API = {
  online: false,
  healthData: null,
  services: null,

  async request(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    const res = await fetch(`/api${path}`, { ...opts, headers, credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText || 'API error');
    return data;
  },

  async health() {
    const data = await this.request('/health');
    this.online = true;
    this.healthData = data;
    this.services = data.services;
    return data;
  },

  async settingsStatus() {
    const data = await this.request('/settings/status');
    this.services = data.services;
    return data;
  },

  async detect(input, checkEligibility = true) {
    const data = await this.request('/detect', {
      method: 'POST',
      body: JSON.stringify({ input, checkEligibility }),
    });
    return data.result;
  },

  async checkEligibility(openseaSlug, phaseIndex, phaseUuid, walletIds) {
    const data = await this.request('/detect/eligibility', {
      method: 'POST',
      body: JSON.stringify({ openseaSlug, phaseIndex, phaseUuid, walletIds }),
    });
    return data;
  },

  async ethPrice() {
    const data = await this.request('/price/eth');
    return data.usd;
  },

  async gasPrice() {
    return this.request('/gas');
  },

  async envRpcs() {
    return this.request('/rpc/env');
  },

  async workerStatus() {
    return this.request('/worker/status');
  },

  async networks() {
    return this.request('/networks');
  },

  async rpcHealth(chain) {
    return this.request(`/rpc/health?chain=${encodeURIComponent(chain || 'ethereum')}`);
  },

  async pingRpc(id) {
    return this.request('/rpc/ping', { method: 'POST', body: JSON.stringify({ id }) });
  },

  async listWallets() {
    return this.request('/wallets');
  },

  async inspectWallet(address, chain = 'ethereum') {
    const query = new URLSearchParams({ address, chain });
    return this.request(`/wallets/inspect?${query}`);
  },

  async portfolio(chain, minBalance) {
    const qs = new URLSearchParams({ chain: chain || 'ethereum' });
    if (minBalance != null) qs.set('minBalance', String(minBalance));
    return this.request(`/portfolio?${qs}`);
  },

  async addExternalWallet(name, address, balance = 0) {
    return this.request('/wallets/import', {
      method: 'POST',
      body: JSON.stringify({ name, address, balance }),
    });
  },

  async deleteWallet(id) {
    return this.request(`/wallets/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async batchDeleteWallets(ids) {
    return this.request('/wallets/batch-delete', { method: 'POST', body: JSON.stringify({ ids }) });
  },

  async listTasks() {
    return this.request('/tasks');
  },

  async createTask(task) {
    return this.request('/tasks', { method: 'POST', body: JSON.stringify(task) });
  },

  async cancelTask(id) {
    return this.request(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async runTaskNow(id, task) {
    return this.request(`/tasks/${encodeURIComponent(id)}/run`, {
      method: 'POST', body: JSON.stringify({ task }),
    });
  },

  async prewarmTask(id, task) {
    return this.request(`/tasks/${encodeURIComponent(id)}/prewarm`, {
      method: 'POST', body: JSON.stringify({ task }),
    });
  },

  async taskReadiness(id) {
    return this.request(`/tasks/${encodeURIComponent(id)}/readiness`);
  },

  async confirmTask(id) {
    return this.request(`/tasks/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: JSON.stringify({ confirm: true }) });
  },

  async preflightStatus() {
    return this.request('/preflight');
  },

  async runPreflight() {
    return this.request('/preflight', { method: 'POST', body: '{}' });
  },

  async retryTask(id, task) {
    return this.request(`/tasks/${encodeURIComponent(id)}/retry`, {
      method: 'POST', body: JSON.stringify({ task }),
    });
  },

  async skipTask(id, task) {
    return this.request(`/tasks/${encodeURIComponent(id)}/skip`, {
      method: 'POST', body: JSON.stringify({ task }),
    });
  },

  async prioritizeTask(id) {
    return this.request(`/tasks/${encodeURIComponent(id)}/priority`, { method: 'POST', body: '{}' });
  },

  async taskReceipt(id) {
    return this.request(`/tasks/${encodeURIComponent(id)}/receipt`);
  },

  async diagOpenSea(n = 5) {
    return this.request(`/diag/opensea?n=${n}`);
  },

  async openSeaStatus() {
    return this.request('/opensea/status');
  },

  async theGraphStatus() {
    return this.request('/thegraph/status');
  },

  async walletConnectStatus() {
    return this.request('/signer/walletconnect/status');
  },

  async walletConnectPair() {
    return this.request('/signer/walletconnect/pair', { method: 'POST', body: '{}' });
  },

  async history() {
    return this.request('/history');
  },

  async testNotify() {
    return this.request('/notify/test', { method: 'POST', body: '{}' });
  },

  async refreshWallets() {
    return this.request('/wallets/refresh', { method: 'POST', body: '{}' });
  },

  // Live balances on a specific chain (robinhood, base, …) — not persisted.
  async walletBalances(chain) {
    return this.request('/wallets/balances', {
      method: 'POST', body: JSON.stringify({ chain }),
    });
  },

  async createFundOp(op) {
    return this.request('/fund', { method: 'POST', body: JSON.stringify(op) });
  },

  async createSweepOp(op) {
    return this.request('/sweep', { method: 'POST', body: JSON.stringify(op) });
  },

  async pnl() {
    return this.request('/pnl');
  },

  // ── Copy Mint ──
  async copymintList() {
    return this.request('/copymint');
  },

  async copymintFeed() {
    return this.request('/copymint/feed');
  },

  async copymintAdd(target) {
    return this.request('/copymint', { method: 'POST', body: JSON.stringify(target) });
  },

  async copymintToggle(id, active) {
    return this.request(`/copymint/${encodeURIComponent(id)}/toggle`, {
      method: 'POST', body: JSON.stringify({ active }),
    });
  },

  async copymintScan() {
    return this.request('/copymint/scan', { method: 'POST', body: '{}' });
  },

  async copymintObserve(event) {
    return this.request('/copymint/observe', { method: 'POST', body: JSON.stringify(event) });
  },

  async copymintRemove(id) {
    return this.request(`/copymint/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  // ── Delegation batch ──
  async delegationList() {
    return this.request('/delegation');
  },

  async delegationDeploy(body) {
    return this.request('/delegation/deploy', { method: 'POST', body: JSON.stringify(body) });
  },

  async delegationMint(id, body) {
    return this.request(`/delegation/${encodeURIComponent(id)}/mint`, {
      method: 'POST', body: JSON.stringify(body),
    });
  },

  async delegationSweep(id, body) {
    return this.request(`/delegation/${encodeURIComponent(id)}/sweep`, {
      method: 'POST', body: JSON.stringify(body),
    });
  },

  async delegationWithdraw(id, body) {
    return this.request(`/delegation/${encodeURIComponent(id)}/withdraw`, {
      method: 'POST', body: JSON.stringify(body),
    });
  },

  async delegationRemove(id) {
    return this.request(`/delegation/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
};
