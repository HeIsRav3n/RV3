// RV3 Auth Client
const RV3_Auth = {
  user: null,

  getToken() {
    return '';
  },

  setToken() {},

  getUser() {
    if (!this.user) {
      try { this.user = JSON.parse(localStorage.getItem('rv3_auth_user') || 'null'); } catch {}
    }
    return this.user;
  },

  setUser(u) {
    this.user = u;
    try { localStorage.setItem('rv3_auth_user', JSON.stringify(u || null)); } catch {}
  },

  async login(email, password) {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    this.setUser(data.user);
    return data;
  },

  async register(email, password) {
    const res = await fetch('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    this.setUser(data.user);
    return data;
  },

  async verify() {
    try {
      const res = await fetch('/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        this.clear();
        return null;
      }
      const data = await res.json();
      this.setUser(data.user);
      return data;
    } catch {
      return null;
    }
  },

  async logout() {
    try { await fetch('/auth/logout', { method: 'POST' }); } catch {}
    this.clear();
  },

  clear() {
    this.user = null;
    try { localStorage.removeItem('rv3_auth_token'); localStorage.removeItem('rv3_auth_user'); } catch {}
  },

  isAuthenticated() {
    return !!this.getUser();
  },

  isAdmin() {
    return this.getUser()?.isAdmin || false;
  },
};
