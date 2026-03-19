import React, { useState, useEffect, createContext, useContext, useCallback } from 'react';
import './index.css';
import { api } from './api';
import MarketsPage from './pages/MarketsPage';
import MarketDetailPage from './pages/MarketDetailPage';
import PortfolioPage from './pages/PortfolioPage';
import LeaderboardPage from './pages/LeaderboardPage';
import CreateMarketPage from './pages/CreateMarketPage';
import AuthModal from './components/AuthModal';
import Toast from './components/Toast';

export const AppContext = createContext(null);
export function useApp() { return useContext(AppContext); }

export default function App() {
  const [page, setPage] = useState('markets');
  const [selectedMarketId, setSelectedMarketId] = useState(null);
  const [user, setUser] = useState(null);
  const [authModal, setAuthModal] = useState(null); // 'login' | 'register' | null
  const [toast, setToast] = useState(null);
  const [stats, setStats] = useState(null);

  const showToast = useCallback((msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const navigate = useCallback((p, marketId = null) => {
    setPage(p);
    if (marketId) setSelectedMarketId(marketId);
    window.scrollTo(0, 0);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('predictx_token');
    setUser(null);
    navigate('markets');
    showToast('Logged out successfully', 'success');
  }, [navigate, showToast]);

  const refreshUser = useCallback(async () => {
    const token = localStorage.getItem('predictx_token');
    if (!token) return;
    try {
      const u = await api.me();
      setUser(u);
    } catch {
      localStorage.removeItem('predictx_token');
    }
  }, []);

  useEffect(() => {
    refreshUser();
    api.getStats().then(setStats).catch(() => {});
  }, [refreshUser]);

  const ctx = { user, setUser, navigate, showToast, refreshUser, authModal, setAuthModal, stats };

  return (
    <AppContext.Provider value={ctx}>
      <div className="app">
        <Nav page={page} navigate={navigate} user={user} logout={logout} setAuthModal={setAuthModal} />
        <main style={{ flex: 1 }}>
          {page === 'markets' && <MarketsPage />}
          {page === 'market' && <MarketDetailPage marketId={selectedMarketId} />}
          {page === 'portfolio' && <PortfolioPage />}
          {page === 'leaderboard' && <LeaderboardPage />}
          {page === 'create' && <CreateMarketPage />}
        </main>
        <Footer />
        {authModal && <AuthModal mode={authModal} onClose={() => setAuthModal(null)} />}
        {toast && <Toast msg={toast.msg} type={toast.type} />}
      </div>
    </AppContext.Provider>
  );
}

function Nav({ page, navigate, user, logout, setAuthModal }) {
  return (
    <nav className="nav">
      <div className="nav-inner">
        <a className="nav-logo" onClick={() => navigate('markets')} style={{ cursor: 'pointer' }}>
          ◈ Predict<span>X</span>
        </a>
        <div className="nav-links">
          <button className={`nav-link ${page === 'markets' || page === 'market' ? 'active' : ''}`} onClick={() => navigate('markets')}>Markets</button>
          {user && <button className={`nav-link ${page === 'portfolio' ? 'active' : ''}`} onClick={() => navigate('portfolio')}>Portfolio</button>}
          <button className={`nav-link ${page === 'leaderboard' ? 'active' : ''}`} onClick={() => navigate('leaderboard')}>Leaderboard</button>
          {user && <button className={`nav-link ${page === 'create' ? 'active' : ''}`} onClick={() => navigate('create')}>+ Create</button>}
        </div>
        <div className="nav-actions">
          {user ? (
            <>
              <span className="nav-balance">${user.balance?.toFixed(2)}</span>
              <span style={{ fontSize: '0.85rem', color: 'var(--text2)' }}>@{user.username}</span>
              <button className="btn btn-ghost btn-sm" onClick={logout}>Logout</button>
            </>
          ) : (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => setAuthModal('login')}>Log in</button>
              <button className="btn btn-primary btn-sm" onClick={() => setAuthModal('register')}>Sign up</button>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

function Footer() {
  return (
    <footer style={{ borderTop: '1px solid var(--border)', padding: '24px', textAlign: 'center', color: 'var(--text3)', fontSize: '0.8rem', marginTop: '64px' }}>
      <span style={{ fontFamily: 'var(--font-mono)' }}>◈ PredictX</span> — Crypto & Finance Prediction Markets · Play money only · For entertainment purposes
    </footer>
  );
}
