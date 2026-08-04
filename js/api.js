// RV3 API client — talks to local Express backend (same origin when using npm start)
const RV3_API = {
  online: false,
  healthData: null,
  services: null,

  token() {
    try { return sessionStorage.getItem('rv3_api_token') || ''; } catch { return ''; }
  },
  setToken(t) {
    try { sessionStorage.setItem('rv3_api_token', t || ''); } catch { /* */ }
  },

  async request(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    const tok = this.token();
    if (tok) headers['X-RV3-Token'] = tok;
    // Add auth token if available
    if (typeof RV3_Auth !== 'undefined' && RV3_Auth.getToken()) {
      headers['X-Auth-Token'] = RV3_Auth.getToken();
    }
    const res = await fetch(`/api${path}`, { ...opts, headers });
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

  async pingRpc(url, id) {
    const body = {};
    if (id) body.id = id;
    if (url) body.url = url;
    return this.request('/rpc/ping', { method: 'POST', body: JSON.stringify(body) });
  },

  async listWallets() {
    return this.request('/wallets');
  },

  async previewWallet(privateKey) {
    return this.request('/wallets/preview', {
      method: 'POST',
      body: JSON.stringify({ privateKey }),
    });
  },

  async importWallet(name, privateKey, balance) {
    return this.request('/wallets/import', {
      method: 'POST',
      body: JSON.stringify({ name, privateKey, balance }),
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

  async prioritizeTask(id) {
    return this.request(`/tasks/${encodeURIComponent(id)}/priority`, { method: 'POST', body: '{}' });
  },

  async taskReceipt(id) {
    return this.request(`/tasks/${encodeURIComponent(id)}/receipt`);
  },

  async diagOpenSea(n = 5) {
    return this.request(`/diag/opensea?n=${n}`);
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

  async copymintRemove(id) {
    return this.request(`/copymint/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
};
