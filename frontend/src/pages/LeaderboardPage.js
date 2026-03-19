import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { useApp } from '../App';

export default function LeaderboardPage() {
  const { user } = useApp();
  const [board, setBoard] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getLeaderboard().then(setBoard).finally(() => setLoading(false));
  }, []);

  const medals = ['🥇', '🥈', '🥉'];

  return (
    <div className="page" style={{ paddingTop: 32, paddingBottom: 48, maxWidth: 800 }}>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 800, marginBottom: 8 }}>Leaderboard</h1>
      <p className="text-muted" style={{ marginBottom: 32 }}>Top traders ranked by total portfolio value</p>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 64 }}><div className="spinner" style={{ width: 40, height: 40, margin: '0 auto' }} /></div>
      ) : board.length === 0 ? (
        <div className="empty-state"><div className="empty-state-icon">🏆</div><div>No traders yet — be the first!</div></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {board.map((entry, i) => (
            <div key={entry.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px', borderColor: user?.id === entry.id ? 'var(--accent)' : 'var(--border)', background: user?.id === entry.id ? 'rgba(0,211,149,0.04)' : 'var(--bg2)' }}>
              <div style={{ width: 32, textAlign: 'center', fontSize: i < 3 ? '1.25rem' : '0.9rem', fontFamily: 'var(--font-mono)', color: 'var(--text3)', fontWeight: 700 }}>
                {i < 3 ? medals[i] : `#${i + 1}`}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {entry.username}
                  {user?.id === entry.id && <span className="badge badge-open" style={{ fontSize: '0.65rem' }}>YOU</span>}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{entry.totalTrades} trades</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '1.1rem', color: 'var(--green)' }}>
                  ZAR {entry.portfolioValue?.toFixed(2)}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>portfolio value</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
