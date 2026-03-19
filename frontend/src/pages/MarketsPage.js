import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { useApp } from '../App';
import MarketCard from '../components/MarketCard';

export default function MarketsPage() {
  const { navigate, stats } = useApp();
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    api.getMarkets({ category: category !== 'All' ? category : undefined, search: search || undefined })
      .then(setMarkets)
      .finally(() => setLoading(false));
  }, [category, search]);

  const categories = ['All', 'Crypto', 'Finance'];

  function fmtBig(n) {
    if (!n) return 'ZAR 0';
    const num = parseFloat(n);
    if (num >= 1000000) return `ZAR ${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `ZAR ${(num / 1000).toFixed(0)}K`;
    return `ZAR ${num}`;
  }

  return (
    <div className="page" style={{ paddingTop: 0 }}>
      <div className="hero">
        <div className="hero-tag">◈ Prediction Exchange</div>
        <h1 className="hero-title">
          Trade on the future of<br /><span className="accent">Crypto & Finance</span>
        </h1>
        <p className="hero-sub">
          Buy and sell shares in outcomes. Every share pays ZAR 1 if correct. The market price reflects collective probability.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button className="btn btn-primary btn-lg" onClick={() => navigate('markets')}>Explore Markets</button>
        </div>
        {stats && (
          <div className="hero-stats">
            <div><span className="hero-stat-value">{stats.openMarkets}</span><span className="hero-stat-label">Active Markets</span></div>
            <div><span className="hero-stat-value">{fmtBig(stats.totalVolume)}</span><span className="hero-stat-label">Total Volume</span></div>
            <div><span className="hero-stat-value">{stats.totalUsers}</span><span className="hero-stat-label">Traders</span></div>
            <div><span className="hero-stat-value">{stats.totalTrades}</span><span className="hero-stat-label">Trades</span></div>
          </div>
        )}
      </div>

      <div style={{ marginBottom: 48 }}>
        <div className="section-header"><h2 className="section-title">How It Works</h2></div>
        <div className="grid-3">
          {[
            { icon: '📊', title: 'Pick a Market', desc: 'Browse open markets for upcoming crypto or financial events.' },
            { icon: '💰', title: 'Buy Shares', desc: "Buy YES or NO shares. Prices reflect the crowd's probability estimate." },
            { icon: '✅', title: 'Get Paid', desc: 'When a market resolves, winning shares pay out ZAR 1 each. Profit from being right.' }
          ].map((s, i) => (
            <div key={i} className="card" style={{ textAlign: 'center', padding: '28px 20px' }}>
              <div style={{ fontSize: '2rem', marginBottom: 12 }}>{s.icon}</div>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>{s.title}</div>
              <div style={{ fontSize: '0.875rem', color: 'var(--text2)', lineHeight: 1.6 }}>{s.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="section-header">
          <h2 className="section-title">Open Markets</h2>
          <span style={{ fontSize: '0.85rem', color: 'var(--text2)' }}>{markets.length} markets</span>
        </div>
        <div className="filter-bar">
          {categories.map(c => (
            <button key={c} className={`filter-chip ${category === c ? 'active' : ''}`} onClick={() => setCategory(c)}>{c}</button>
          ))}
          <div className="search-wrap">
            <span className="search-icon">🔍</span>
            <input className="input search-input" placeholder="Search markets..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '64px', color: 'var(--text2)' }}>
            <div className="spinner" style={{ width: 32, height: 32, margin: '0 auto 12px' }} />
            <div>Loading markets...</div>
          </div>
        ) : markets.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📭</div>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>No markets found</div>
            <div>Try a different search or category</div>
          </div>
        ) : (
          <div className="grid-markets">
            {markets.map(m => (
              <MarketCard key={m.id} market={m} onClick={() => navigate('market', m.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
