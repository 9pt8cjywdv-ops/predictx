import React, { useState } from 'react';
import { api } from '../api';
import { useApp } from '../App';

export default function AuthModal({ mode, onClose }) {
  const { setUser, showToast, setAuthModal } = useApp();
  const [form, setForm] = useState({ username: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const isLogin = mode === 'login';

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      const data = isLogin
        ? await api.login({ email: form.email, password: form.password })
        : await api.register(form);
      localStorage.setItem('predictx_token', data.token);
      setUser(data.user);
      showToast(`Welcome${isLogin ? ' back' : ''}, ${data.user.username}! 🎉`);
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 className="modal-title" style={{ marginBottom: 0 }}>
            {isLogin ? 'Welcome back' : 'Create account'}
          </h2>
          <button onClick={onClose} style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text2)', cursor: 'pointer', width: 32, height: 32, fontSize: '1.1rem' }}>×</button>
        </div>

        {!isLogin && (
          <div style={{ background: 'rgba(0,211,149,0.06)', border: '1px solid rgba(0,211,149,0.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: '0.85rem', color: 'var(--green)' }}>
            🎁 New users start with <strong>$1,000</strong> in play money
          </div>
        )}

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!isLogin && (
            <div className="form-group">
              <label className="label">Username</label>
              <input className="input" placeholder="trader_pro" value={form.username} onChange={set('username')} required />
            </div>
          )}
          <div className="form-group">
            <label className="label">Email</label>
            <input className="input" type="email" placeholder="you@example.com" value={form.email} onChange={set('email')} required />
          </div>
          <div className="form-group">
            <label className="label">Password</label>
            <input className="input" type="password" placeholder="••••••••" value={form.password} onChange={set('password')} required minLength={6} />
          </div>

          {err && <div style={{ color: 'var(--red)', fontSize: '0.85rem', padding: '8px 12px', background: 'rgba(255,73,118,0.08)', borderRadius: 6 }}>{err}</div>}

          <button className="btn btn-primary btn-lg w-full" type="submit" disabled={loading} style={{ marginTop: 4 }}>
            {loading ? <span className="spinner" /> : (isLogin ? 'Log in' : 'Create account')}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 16, fontSize: '0.85rem', color: 'var(--text2)' }}>
          {isLogin ? "Don't have an account? " : 'Already have an account? '}
          <span style={{ color: 'var(--accent)', cursor: 'pointer', fontWeight: 700 }}
            onClick={() => setAuthModal(isLogin ? 'register' : 'login')}>
            {isLogin ? 'Sign up' : 'Log in'}
          </span>
        </div>
      </div>
    </div>
  );
}
