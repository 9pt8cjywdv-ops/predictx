import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { useApp } from '../App';
import TradePanel from '../components/TradePanel';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

function fmtVol(n) {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n?.toFixed(0) || 0}`;
}

// Generate mock price history for visualization
function genHistory(yesPrice, numPoints = 30) {
  const data = [];
  let price = 0.5;
  for (let i = 0; i < numPoints; i++) {
    price += (Math.random() - 0.48) * 0.04;
    price = Math.max(0.02, Math.min(0.98, price));
    data.push({ t: i, yes: parseFloat(price.toFixed(3)), no: parseFloat((1 - price).toFixed(3)) });
  }
  // Nudge last point toward actual price
  data[data.length - 1].yes = yesPrice;
  data[data.length - 1].no = parseFloat((1 - yesPrice).toFixed(3));
  return data;
}

export default function MarketDetailPage({ marketId }) {
  const { navigate, user, showToast, setAuthModal } = useApp();
  const [market, setMarket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('trades');
  const [portfolio, setPortfolio] = useState(null);
  const [priceHistory, setPriceHistory] = useState([]);

  const load = useCallback(async () => {
    try {
      const m = await api.getMarket(marketId);
      setMarket(m);
      setPriceHistory(genHistory(m.yesPrice));
    } finally {
      setLoading(false);
    }
  }, [marketId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (user) api.getPortfolio().then(setPortfolio).catch(() => {});
  }, [user]);

  function handleTraded(result) {
    setMarket(prev => ({
      ...prev,
      yesPrice: result.market.yesPrice,
      noPrice: result.market.noPrice,
      volume: result.market.volume,
    }));
    if (user) api.getPortfolio().then(setPortfolio).catch(() => {});
    setPriceHistory(prev => {
      const newPt = { t: prev.length, yes: result.market.yesPrice, no: result.market.noPrice };
      return [...prev, newPt];
    });
  }

  if (loading) return (
    <div style={{ textAlign: 'center', padding: 80 }}>
      <div className="spinner" style={{ width: 40, height: 40, margin: '0 auto 16px' }} />
      <div className="text-muted">Loading market...</div>
    </div>
  );

  if (!market) return <div className="page"><div className="empty-state">Market not found</div></div>;

  const userPosition = portfolio?.positions?.find(p => p.marketId === market.id);
  const yesP = Math.round(market.yesPrice * 100);
  const noP = Math.round(market.noPrice * 100);

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload?.length) {
      return (
        <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: '0.8rem' }}>
          <div className="text-green">YES {(payload[0]?.value * 100).toFixed(1)}¢</div>
          <div className="text-red">NO {(payload[1]?.value * 100).toFixed(1)}¢</div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="page" style={{ paddingTop: 32, paddingBottom: 48 }}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24, fontSize: '0.85rem', color: 'var(--text2)' }}>
        <span style={{ cursor: 'pointer', color: 'var(--accent)' }} onClick={() => navigate('markets')}>Markets</span>
        <span>›</span>
        <span className={`badge badge-${market.category.toLowerCase()}`}>{market.category}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 24, alignItems: 'start' }}>
        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Market header */}
          <div className="card">
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <span className={`badge badge-${market.category.toLowerCase()}`}>{market.category}</span>
              {market.asset && <span style={{ fontSize: '0.7rem', color: 'var(--text3)', fontFamily: 'var(--font-mono)', padding: '2px 0' }}>{market.asset}</span>}
              <span className={`badge badge-${market.status}`}>{market.status}</span>
            </div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800, lineHeight: 1.3, marginBottom: 12 }}>{market.title}</h1>
            <p style={{ color: 'var(--text2)', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: 16 }}>{market.description}</p>

            {/* Big price display */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
              <div style={{ flex: 1, background: 'rgba(0,211,149,0.06)', border: '1px solid rgba(0,211,149,0.15)', borderRadius: 10, padding: '16px', textAlign: 'center' }}>
                <div style={{ fontSize: '2.5rem', fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--green)' }}>{yesP}¢</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--green)', marginTop: 4, opacity: 0.7 }}>YES probability</div>
              </div>
              <div style={{ flex: 1, background: 'rgba(255,73,118,0.06)', border: '1px solid rgba(255,73,118,0.15)', borderRadius: 10, padding: '16px', textAlign: 'center' }}>
                <div style={{ fontSize: '2.5rem', fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--red)' }}>{noP}¢</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--red)', marginTop: 4, opacity: 0.7 }}>NO probability</div>
              </div>
            </div>

            <div className="stats-row">
              <div className="stat-item">
                <span className="stat-label">Volume</span>
                <span className="stat-value">{fmtVol(market.volume)}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Liquidity</span>
                <span className="stat-value">{fmtVol(market.liquidity)}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">End Date</span>
                <span className="stat-value text-xs">{market.endDate}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Source</span>
                <span className="stat-value text-xs" style={{ color: 'var(--text2)', fontSize: '0.75rem' }}>{market.resolutionSource}</span>
              </div>
            </div>
          </div>

          {/* Price chart */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Price History</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>SIMULATED</span>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={priceHistory}>
                <XAxis dataKey="t" hide />
                <YAxis domain={[0, 1]} tickFormatter={v => `${Math.round(v * 100)}¢`} tick={{ fontSize: 11, fill: 'var(--text3)', fontFamily: 'Space Mono' }} width={40} />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine y={0.5} stroke="var(--border2)" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="yes" stroke="var(--green)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="no" stroke="var(--red)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 8, fontSize: '0.75rem' }}>
              <span className="text-green">● YES</span>
              <span className="text-red">● NO</span>
            </div>
          </div>

          {/* My position */}
          {userPosition && (
            <div className="card" style={{ borderColor: userPosition.outcome === 'YES' ? 'rgba(0,211,149,0.3)' : 'rgba(255,73,118,0.3)' }}>
              <div className="card-header">
                <span className="card-title">Your Position</span>
                <span className={`badge ${userPosition.outcome === 'YES' ? 'badge-open' : ''}`} style={userPosition.outcome === 'NO' ? { background: 'rgba(255,73,118,0.1)', color: 'var(--red)' } : {}}>
                  {userPosition.outcome}
                </span>
              </div>
              <div className="grid-2">
                <div>
                  <div className="stat-label">Shares</div>
                  <div className="stat-value">{userPosition.shares}</div>
                </div>
                <div>
                  <div className="stat-label">Avg Price</div>
                  <div className="stat-value">{(userPosition.avgPrice * 100).toFixed(1)}¢</div>
                </div>
                <div>
                  <div className="stat-label">Current Value</div>
                  <div className="stat-value">${userPosition.currentValue?.toFixed(2)}</div>
                </div>
                <div>
                  <div className="stat-label">P&L</div>
                  <div className={userPosition.pnl >= 0 ? 'pnl-pos stat-value' : 'pnl-neg stat-value'}>
                    {userPosition.pnl >= 0 ? '+' : ''}{userPosition.pnl?.toFixed(2)} ({userPosition.pnlPct >= 0 ? '+' : ''}{userPosition.pnlPct?.toFixed(1)}%)
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tabs: Trades / About */}
          <div className="card">
            <div className="tabs">
              <button className={`tab ${tab === 'trades' ? 'active' : ''}`} onClick={() => setTab('trades')}>Recent Trades</button>
              <button className={`tab ${tab === 'about' ? 'active' : ''}`} onClick={() => setTab('about')}>About</button>
            </div>

            {tab === 'trades' && (
              market.recentTrades?.length ? (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Outcome</th>
                      <th>Shares</th>
                      <th>Price</th>
                      <th>Amount</th>
                      <th>Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {market.recentTrades.slice(0, 20).map(t => (
                      <tr key={t.id}>
                        <td>
                          <span style={{ color: t.outcome === 'YES' ? 'var(--green)' : 'var(--red)', fontWeight: 700, fontSize: '0.8rem' }}>
                            {t.outcome}
                          </span>
                        </td>
                        <td className="text-mono">{t.shares}</td>
                        <td className="text-mono">{(t.price * 100).toFixed(1)}¢</td>
                        <td className="text-mono">${t.amount?.toFixed(2)}</td>
                        <td>
                          <span style={{ fontSize: '0.75rem', color: t.type === 'buy' ? 'var(--green)' : 'var(--red)' }}>{t.type}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="empty-state" style={{ padding: 32 }}>
                  <div>No trades yet — be the first!</div>
                </div>
              )
            )}

            {tab === 'about' && (
              <div style={{ fontSize: '0.9rem', color: 'var(--text2)', lineHeight: 1.7 }}>
                <p style={{ marginBottom: 12 }}>{market.description}</p>
                <div className="divider" />
                <div className="stats-row">
                  <div className="stat-item">
                    <span className="stat-label">Resolution Source</span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text)' }}>{market.resolutionSource}</span>
                  </div>
                </div>
                <div className="divider" />
                <div style={{ fontSize: '0.8rem', color: 'var(--text3)' }}>
                  Each share pays <strong style={{ color: 'var(--text2)' }}>$1.00</strong> if the market resolves in that outcome's favor.
                  Prices represent the crowd's probability estimate (0¢ = impossible, 100¢ = certain).
                  A 2% fee applies on sells.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right column: Trade panel */}
        <div style={{ position: 'sticky', top: 80 }}>
          <TradePanel market={market} onTraded={handleTraded} />
        </div>
      </div>
    </div>
  );
}
