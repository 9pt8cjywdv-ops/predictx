import React from 'react';

function fmt(n) {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
  return `$${n}`;
}

export default function MarketCard({ market, onClick }) {
  const yesP = Math.round(market.yesPrice * 100);
  const noP = Math.round(market.noPrice * 100);

  return (
    <div className="market-card" onClick={onClick}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            <span className={`badge badge-${market.category.toLowerCase()}`}>{market.category}</span>
            {market.asset && <span style={{ fontSize: '0.7rem', color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{market.asset}</span>}
            <span className={`badge badge-${market.status}`}>{market.status}</span>
          </div>
          <p className="market-card-title">{market.title}</p>
        </div>
      </div>

      <div className="prob-bar-wrap">
        <div className="prob-bar-labels">
          <span className="prob-bar-yes">YES {yesP}¢</span>
          <span className="prob-bar-no">NO {noP}¢</span>
        </div>
        <div className="prob-bar">
          <div className="prob-bar-fill-yes" style={{ width: `${yesP}%` }} />
        </div>
      </div>

      <div className="stats-row">
        <div className="stat-item">
          <span className="stat-label">Volume</span>
          <span className="stat-value">{fmt(market.volume)}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Liquidity</span>
          <span className="stat-value">{fmt(market.liquidity)}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Ends</span>
          <span className="stat-value" style={{ fontSize: '0.8rem' }}>{market.endDate}</span>
        </div>
      </div>
    </div>
  );
}
