// RV3 Auth Client
const RV3_Auth = {
  token: null,
  user: null,

  getToken() {
    if (!this.token) {
      try { this.token = localStorage.getItem('rv3_auth_token'); } catch {}
    }
    return this.token;
  },

  setToken(t) {
    this.token = t;
    try { localStorage.setItem('rv3_auth_token', t || ''); } catch {}
  },

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
    this.setToken(data.token);
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
    this.setToken(data.token);
    this.setUser(data.user);
    return data;
  },

  async verify() {
    const token = this.getToken();
    if (!token) return null;
    try {
      const res = await fetch('/auth/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': token,
        },
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
    const token = this.getToken();
    if (token) {
      try {
        await fetch('/auth/logout', {
          method: 'POST',
          headers: { 'X-Auth-Token': token },
        });
      } catch {}
    }
    this.clear();
  },

  clear() {
    this.token = null;
    this.user = null;
    try { localStorage.removeItem('rv3_auth_token'); localStorage.removeItem('rv3_auth_user'); } catch {}
  },

  isAuthenticated() {
    return !!this.getToken();
  },

  isAdmin() {
    return this.getUser()?.isAdmin || false;
  },
};
