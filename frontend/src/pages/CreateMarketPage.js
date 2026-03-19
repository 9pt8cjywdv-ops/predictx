import React, { useState } from 'react';
import { api } from '../api';
import { useApp } from '../App';

export default function CreateMarketPage() {
  const { user, navigate, showToast, setAuthModal } = useApp();
  const [form, setForm] = useState({ title: '', description: '', category: 'Crypto', asset: '', endDate: '', resolutionSource: '' });
  const [loading, setLoading] = useState(false);

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const market = await api.createMarket(form);
      showToast('Market created successfully!');
      navigate('market', market.id);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  if (!user) return (
    <div className="page" style={{ paddingTop: 64, textAlign: 'center' }}>
      <div style={{ fontSize: '2rem', marginBottom: 16 }}>🔒</div>
      <h2 style={{ marginBottom: 8 }}>Sign in to create markets</h2>
      <button className="btn btn-primary" onClick={() => setAuthModal('login')}>Log in</button>
    </div>
  );

  return (
    <div className="page" style={{ paddingTop: 32, paddingBottom: 48, maxWidth: 640 }}>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 800, marginBottom: 8 }}>Create a Market</h1>
      <p className="text-muted" style={{ marginBottom: 32 }}>Set up a new prediction market for the community to trade on</p>

      <form onSubmit={submit}>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="form-group">
            <label className="label">Question *</label>
            <input className="input" placeholder="Will Bitcoin exceed $200,000 in 2025?" value={form.title} onChange={set('title')} required maxLength={200} />
            <span style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>Write a clear yes/no question that can be objectively resolved</span>
          </div>

          <div className="form-group">
            <label className="label">Description *</label>
            <textarea className="input textarea" placeholder="Describe resolution criteria in detail..." value={form.description} onChange={set('description')} required rows={4} />
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label className="label">Category *</label>
              <select className="input select" value={form.category} onChange={set('category')}>
                <option value="Crypto">Crypto</option>
                <option value="Finance">Finance</option>
              </select>
            </div>
            <div className="form-group">
              <label className="label">Asset Symbol</label>
              <input className="input" placeholder="BTC, ETH, SPX..." value={form.asset} onChange={set('asset')} maxLength={10} />
            </div>
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label className="label">End Date *</label>
              <input className="input" type="date" value={form.endDate} onChange={set('endDate')} required min={new Date().toISOString().split('T')[0]} />
            </div>
            <div className="form-group">
              <label className="label">Resolution Source</label>
              <input className="input" placeholder="CoinGecko, Fed.gov, NYSE..." value={form.resolutionSource} onChange={set('resolutionSource')} />
            </div>
          </div>

          <div style={{ background: 'rgba(0,211,149,0.06)', border: '1px solid rgba(0,211,149,0.15)', borderRadius: 8, padding: '12px 14px', fontSize: '0.85rem', color: 'var(--text2)' }}>
            ℹ️ Markets start at <strong style={{ color: 'var(--text)' }}>50/50</strong>. Prices update automatically as people trade using the AMM pricing engine.
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <button type="button" className="btn btn-secondary" onClick={() => navigate('markets')}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ flex: 1 }}>
              {loading ? <span className="spinner" /> : 'Create Market'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
