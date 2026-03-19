import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { useApp } from '../App';

export default function PortfolioPage() {
  const { user, navigate, setAuthModal } = useApp();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('positions');

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    api.getPortfolio().then(setData).finally(() => setLoading(false));
  }, [user]);

  if (!user) return (
    <div className="page" style={{ paddingTop: 64, textAlign: 'center' }}>
      <div style={{ fontSize: '2rem', marginBottom: 16 }}>🔒</div>
      <h2 style={{ marginBottom: 8 }}>Sign in to view your portfolio</h2>
      <p className="text-muted" style={{ marginBottom: 24 }}>Track your positions, P&L, and trade history</p>
      <button className="btn btn-primary" onClick={() => setAuthModal('login')}>Log in</button>
    </div>
  );

  if (loading) return <div style={{ textAlign: 'center', padding: 80 }}><div className="spinner" style={{ width: 40, height: 40, margin: '0 auto' }} /></div>;

  const { positions = [], trades = [], summary = {} } = data || {};

  return (
    <div className="page" style={{ paddingTop: 32, paddingBottom: 48 }}>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 800, marginBottom: 24 }}>Portfolio</h1>

      {/* Summary cards */}
      <div className="grid-3" style={{ marginBottom: 32 }}>
        {[
          { label: 'Cash Balance', value: `$${summary.balance?.toFixed(2) || '0.00'}`, color: 'var(--green)' },
          { label: 'Positions Value', value: `$${summary.totalValue?.toFixed(2) || '0.00'}`, color: 'var(--blue2)' },
          { label: 'Total P&L', value: `${summary.totalPnl >= 0 ? '+' : ''}$${summary.totalPnl?.toFixed(2) || '0.00'}`, color: summary.totalPnl >= 0 ? 'var(--green)' : 'var(--red)' },
        ].map((s, i) => (
          <div key={i} className="card" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>{s.label}</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'positions' ? 'active' : ''}`} onClick={() => setTab('positions')}>Positions ({positions.length})</button>
        <button className={`tab ${tab === 'trades' ? 'active' : ''}`} onClick={() => setTab('trades')}>Trade History ({trades.length})</button>
      </div>

      {tab === 'positions' && (
        positions.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📊</div>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>No open positions</div>
            <div className="text-muted" style={{ marginBottom: 16 }}>Start trading to build your portfolio</div>
            <button className="btn btn-primary" onClick={() => navigate('markets')}>Browse Markets</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {positions.map(p => (
              <div key={p.id} className="card" style={{ cursor: 'pointer', borderColor: p.outcome === 'YES' ? 'rgba(0,211,149,0.15)' : 'rgba(255,73,118,0.15)' }}
                onClick={() => navigate('market', p.marketId)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                      <span className={`badge badge-${p.market?.category?.toLowerCase()}`}>{p.market?.category}</span>
                      <span style={{ fontWeight: 700, fontSize: '0.8rem', color: p.outcome === 'YES' ? 'var(--green)' : 'var(--red)' }}>{p.outcome}</span>
                    </div>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>{p.market?.title}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div className={p.pnl >= 0 ? 'pnl-pos' : 'pnl-neg'} style={{ fontSize: '1.1rem', fontWeight: 800 }}>
                      {p.pnl >= 0 ? '+' : ''}{p.pnl?.toFixed(2)}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>{p.pnlPct >= 0 ? '+' : ''}{p.pnlPct?.toFixed(1)}%</div>
                  </div>
                </div>
                <div className="stats-row" style={{ marginTop: 8 }}>
                  <div className="stat-item"><span className="stat-label">Shares</span><span className="stat-value">{p.shares}</span></div>
                  <div className="stat-item"><span className="stat-label">Avg Price</span><span className="stat-value">{(p.avgPrice * 100).toFixed(1)}¢</span></div>
                  <div className="stat-item"><span className="stat-label">Current</span><span className="stat-value">{(p.currentPrice * 100).toFixed(1)}¢</span></div>
                  <div className="stat-item"><span className="stat-label">Value</span><span className="stat-value">${p.currentValue?.toFixed(2)}</span></div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'trades' && (
        trades.length === 0 ? (
          <div className="empty-state"><div className="empty-state-icon">📋</div><div>No trades yet</div></div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="table">
              <thead>
                <tr><th>Market</th><th>Outcome</th><th>Type</th><th>Shares</th><th>Price</th><th>Amount</th><th>Date</th></tr>
              </thead>
              <tbody>
                {trades.map(t => (
                  <tr key={t.id}>
                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.8rem' }}>{t.marketId?.slice(0, 8)}…</td>
                    <td><span style={{ color: t.outcome === 'YES' ? 'var(--green)' : 'var(--red)', fontWeight: 700, fontSize: '0.8rem' }}>{t.outcome}</span></td>
                    <td><span style={{ color: t.type === 'buy' ? 'var(--green)' : 'var(--red)', fontSize: '0.8rem' }}>{t.type}</span></td>
                    <td className="text-mono">{t.shares}</td>
                    <td className="text-mono">{(t.price * 100).toFixed(1)}¢</td>
                    <td className="text-mono">${t.amount?.toFixed(2)}</td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>{new Date(t.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
