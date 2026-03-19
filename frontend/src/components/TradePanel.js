import React, { useState } from 'react';
import { api } from '../api';
import { useApp } from '../App';

export default function TradePanel({ market, onTraded }) {
  const { user, setUser, showToast, setAuthModal, refreshUser } = useApp();
  const [outcome, setOutcome] = useState('YES');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('buy');
  const [loading, setLoading] = useState(false);

  const price = outcome === 'YES' ? market.yesPrice : market.noPrice;
  const shares = amount ? parseFloat((parseFloat(amount) / price).toFixed(2)) : 0;
  const potentialPayout = shares * 1.0;
  const potentialProfit = potentialPayout - parseFloat(amount || 0);

  async function executeTrade() {
    if (!user) { setAuthModal('login'); return; }
    if (!amount || parseFloat(amount) <= 0) return;
    setLoading(true);
    try {
      let result;
      if (mode === 'buy') {
        result = await api.buy({ marketId: market.id, outcome, amount: parseFloat(amount) });
        setUser(result.user);
        showToast(`Bought ${result.trade.shares} ${outcome} shares @ ${(price * 100).toFixed(0)}¢`);
      } else {
        result = await api.sell({ marketId: market.id, outcome, shares: parseFloat(amount) });
        setUser(result.user);
        showToast(`Sold ${amount} ${outcome} shares for ZAR ${result.proceeds}`);
      }
      setAmount('');
      if (onTraded) onTraded(result);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  const quickAmounts = [10, 25, 50, 100, 250];

  return (
    <div className="card trade-panel">
      <div className="card-header">
        <span className="card-title">Trade</span>
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg3)', borderRadius: 8, padding: 3 }}>
          <button className="btn btn-sm" style={{ background: mode === 'buy' ? 'var(--bg4)' : 'transparent', color: mode === 'buy' ? 'var(--text)' : 'var(--text2)', border: 'none' }} onClick={() => setMode('buy')}>Buy</button>
          <button className="btn btn-sm" style={{ background: mode === 'sell' ? 'var(--bg4)' : 'transparent', color: mode === 'sell' ? 'var(--text)' : 'var(--text2)', border: 'none' }} onClick={() => setMode('sell')}>Sell</button>
        </div>
      </div>

      {market.status !== 'open' && (
        <div style={{ background: 'rgba(139,148,158,0.08)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontSize: '0.85rem', color: 'var(--text2)', textAlign: 'center' }}>
          This market is {market.status}
          {market.resolution && <> · Resolved <strong>{market.resolution}</strong></>}
        </div>
      )}

      {market.status === 'open' && (
        <>
          <div className="outcome-btns">
            <button className={`outcome-btn outcome-btn-yes ${outcome === 'YES' ? 'active' : ''}`} onClick={() => setOutcome('YES')}>
              <div style={{ fontSize: '1.25rem', fontFamily: 'var(--font-mono)', fontWeight: 800 }}>{Math.round(market.yesPrice * 100)}¢</div>
              <div style={{ fontSize: '0.75rem', marginTop: 2 }}>YES</div>
            </button>
            <button className={`outcome-btn outcome-btn-no ${outcome === 'NO' ? 'active' : ''}`} onClick={() => setOutcome('NO')}>
              <div style={{ fontSize: '1.25rem', fontFamily: 'var(--font-mono)', fontWeight: 800 }}>{Math.round(market.noPrice * 100)}¢</div>
              <div style={{ fontSize: '0.75rem', marginTop: 2 }}>NO</div>
            </button>
          </div>

          <div className="form-group">
            <label className="label">{mode === 'buy' ? 'Amount (ZAR)' : 'Shares to sell'}</label>
            <input className="input" type="number" min="0" step={mode === 'buy' ? '1' : '0.01'} placeholder={mode === 'buy' ? 'ZAR 0.00' : '0 shares'} value={amount} onChange={e => setAmount(e.target.value)} />
          </div>

          {mode === 'buy' && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {quickAmounts.map(a => (
                <button key={a} className="btn btn-secondary btn-sm" onClick={() => setAmount(String(a))}>ZAR {a}</button>
              ))}
            </div>
          )}

          {amount && parseFloat(amount) > 0 && mode === 'buy' && (
            <div className="order-summary">
              <div className="order-row">
                <span className="text-muted">Avg price</span>
                <span className="text-mono">{(price * 100).toFixed(1)}¢</span>
              </div>
              <div className="order-row">
                <span className="text-muted">Shares</span>
                <span className="text-mono">{shares}</span>
              </div>
              <div className="order-row">
                <span className="text-muted">Max payout</span>
                <span className="text-mono text-green">ZAR {potentialPayout.toFixed(2)}</span>
              </div>
              <div className="order-row">
                <span>Potential profit</span>
                <span className={potentialProfit >= 0 ? 'pnl-pos' : 'pnl-neg'}>
                  {potentialProfit >= 0 ? '+' : ''}{potentialProfit.toFixed(2)}
                </span>
              </div>
            </div>
          )}

          {user && (
            <div style={{ fontSize: '0.8rem', color: 'var(--text2)', display: 'flex', justifyContent: 'space-between' }}>
              <span>Balance</span>
              <span className="text-mono text-green">ZAR {user.balance?.toFixed(2)}</span>
            </div>
          )}

          <button className={`btn w-full ${outcome === 'YES' ? 'btn-primary' : 'btn-danger'}`} onClick={executeTrade} disabled={loading || !amount || parseFloat(amount) <= 0} style={outcome === 'NO' ? { background: 'var(--red)' } : {}}>
            {loading ? <span className="spinner" /> : (!user ? 'Connect to trade' : `${mode === 'buy' ? 'Buy' : 'Sell'} ${outcome}`)}
          </button>
        </>
      )}
    </div>
  );
}
