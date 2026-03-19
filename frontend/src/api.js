const BASE = process.env.REACT_APP_API_URL || '/api';

function getToken() {
  return localStorage.getItem('predictx_token');
}

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  // Auth
  register: (body) => request('POST', '/auth/register', body),
  login: (body) => request('POST', '/auth/login', body),
  me: () => request('GET', '/auth/me'),

  // Markets
  getMarkets: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request('GET', `/markets${q ? '?' + q : ''}`);
  },
  getMarket: (id) => request('GET', `/markets/${id}`),
  createMarket: (body) => request('POST', '/markets', body),
  resolveMarket: (id, outcome) => request('POST', `/markets/${id}/resolve`, { outcome }),

  // Trading
  buy: (body) => request('POST', '/trade', body),
  sell: (body) => request('POST', '/trade/sell', body),

  // Portfolio
  getPortfolio: () => request('GET', '/portfolio'),

  // Leaderboard
  getLeaderboard: () => request('GET', '/leaderboard'),

  // Stats
  getStats: () => request('GET', '/stats'),
};
