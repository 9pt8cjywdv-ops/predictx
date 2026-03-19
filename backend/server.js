const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool, initDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }));
app.use(express.json());

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

async function seedMarkets() {
  const { rows } = await pool.query('SELECT COUNT(*) FROM markets');
  if (parseInt(rows[0].count) > 0) return;
  const markets = [
    { title: 'Will Bitcoin exceed $200,000 by end of 2026?', description: 'Resolves YES if BTC/USD price on any major exchange exceeds $200,000 at any point before December 31, 2026.', category: 'Crypto', asset: 'BTC', yes_price: 0.58, no_price: 0.42, volume: 3200000, liquidity: 520000, end_date: '2026-12-31', yes_shares: 175000, no_shares: 128000, source: 'CoinGecko API' },
    { title: 'Will Ethereum reach $10,000 in 2026?', description: 'Resolves YES if ETH/USD price on any major exchange exceeds $10,000 at any point before December 31, 2026.', category: 'Crypto', asset: 'ETH', yes_price: 0.42, no_price: 0.58, volume: 1750000, liquidity: 290000, end_date: '2026-12-31', yes_shares: 95000, no_shares: 132000, source: 'CoinGecko API' },
    { title: 'Will the Fed cut rates at least 2 times in 2026?', description: 'Resolves YES if the Federal Reserve announces 2 or more interest rate cuts at FOMC meetings in calendar year 2026.', category: 'Finance', asset: 'RATES', yes_price: 0.61, no_price: 0.39, volume: 2800000, liquidity: 540000, end_date: '2026-12-15', yes_shares: 158000, no_shares: 101000, source: 'Federal Reserve Official Statements' },
    { title: 'Will Solana surpass $500 before July 2026?', description: 'Resolves YES if SOL/USD price on any major exchange exceeds $500 at any point before July 1, 2026.', category: 'Crypto', asset: 'SOL', yes_price: 0.38, no_price: 0.62, volume: 1100000, liquidity: 210000, end_date: '2026-06-30', yes_shares: 88000, no_shares: 144000, source: 'CoinGecko API' },
    { title: 'Will S&P 500 reach 7,500 points in 2026?', description: 'Resolves YES if the S&P 500 index closes above 7,500 on any trading day in calendar year 2026.', category: 'Finance', asset: 'SPX', yes_price: 0.64, no_price: 0.36, volume: 4800000, liquidity: 960000, end_date: '2026-12-31', yes_shares: 210000, no_shares: 118000, source: 'NYSE Official Data' },
    { title: 'Will a spot Solana ETF be approved in the US in 2026?', description: 'Resolves YES if the SEC approves at least one spot Solana ETF before December 31, 2026.', category: 'Crypto', asset: 'SOL', yes_price: 0.67, no_price: 0.33, volume: 1950000, liquidity: 380000, end_date: '2026-12-31', yes_shares: 188000, no_shares: 92000, source: 'SEC.gov Official Announcements' },
    { title: 'Will Bitcoin dominance drop below 40% in 2026?', description: 'Resolves YES if Bitcoin market cap dominance drops below 40% on CoinGecko at any point before December 31, 2026.', category: 'Crypto', asset: 'BTC.D', yes_price: 0.33, no_price: 0.67, volume: 870000, liquidity: 165000, end_date: '2026-12-31', yes_shares: 72000, no_shares: 146000, source: 'CoinGecko API' },
    { title: 'Will US inflation drop below 2% by end of 2026?', description: 'Resolves YES if the US CPI year-over-year inflation rate drops below 2.0% in any monthly BLS report before December 31, 2026.', category: 'Finance', asset: 'CPI', yes_price: 0.45, no_price: 0.55, volume: 1420000, liquidity: 280000, end_date: '2026-12-31', yes_shares: 112000, no_shares: 137000, source: 'Bureau of Labor Statistics' },
  ];
  for (const m of markets) {
    await pool.query(`INSERT INTO markets (id,title,description,category,asset,yes_price,no_price,volume,liquidity,end_date,status,resolution_source,total_shares_yes,total_shares_no,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'open',$11,$12,$13,NOW())`,
      [uuidv4(), m.title, m.description, m.category, m.asset, m.yes_price, m.no_price, m.volume, m.liquidity, m.end_date, m.source, m.yes_shares, m.no_shares]);
  }
  console.log('🌱 Markets seeded');
}

app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const id = uuidv4();
    await pool.query('INSERT INTO users (id,username,email,password,balance) VALUES ($1,$2,$3,$4,1000.00)', [id, username, email, hashedPassword]);
    const token = jwt.sign({ id, username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id, username, email, balance: 1000.00 } });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Email or username already taken' });
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
  if (!rows[0]) return res.status(400).json({ error: 'Invalid credentials' });
  const valid = await bcrypt.compare(password, rows[0].password);
  if (!valid) return res.status(400).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: rows[0].id, username: rows[0].username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: rows[0].id, username: rows[0].username, email: rows[0].email, balance: parseFloat(rows[0].balance) } });
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  const { rows } = await pool.query('SELECT id,username,email,balance FROM users WHERE id=$1', [req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json({ ...rows[0], balance: parseFloat(rows[0].balance) });
});

app.get('/api/markets', async (req, res) => {
  const { category, search } = req.query;
  let q = 'SELECT * FROM markets WHERE status=$1';
  const params = ['open'];
  if (category && category !== 'All') { params.push(category); q += ` AND category=$${params.length}`; }
  if (search) { params.push(`%${search}%`); q += ` AND title ILIKE $${params.length}`; }
  q += ' ORDER BY created_at DESC';
  const { rows } = await pool.query(q, params);
  res.json(rows.map(formatMarket));
});

app.get('/api/markets/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM markets WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Market not found' });
  const trades = await pool.query('SELECT * FROM trades WHERE market_id=$1 ORDER BY created_at DESC LIMIT 50', [req.params.id]);
  res.json({ ...formatMarket(rows[0]), recentTrades: trades.rows.map(formatTrade) });
});

app.post('/api/markets', authMiddleware, async (req, res) => {
  const { title, description, category, asset, endDate, resolutionSource } = req.body;
  if (!title || !description || !category || !endDate) return res.status(400).json({ error: 'Missing required fields' });
  const id = uuidv4();
  await pool.query('INSERT INTO markets (id,title,description,category,asset,yes_price,no_price,volume,liquidity,end_date,status,resolution_source,created_by,total_shares_yes,total_shares_no) VALUES ($1,$2,$3,$4,$5,0.50,0.50,0,0,$6,\'open\',$7,$8,1000,1000)',
    [id, title, description, category, asset || 'CUSTOM', endDate, resolutionSource || 'Admin', req.user.id]);
  const { rows } = await pool.query('SELECT * FROM markets WHERE id=$1', [id]);
  res.status(201).json(formatMarket(rows[0]));
});

app.post('/api/trade', authMiddleware, async (req, res) => {
  const { marketId, outcome, amount } = req.body;
  if (!marketId || !outcome || !amount || amount <= 0) return res.status(400).json({ error: 'Invalid parameters' });
  const { rows: mRows } = await pool.query('SELECT * FROM markets WHERE id=$1', [marketId]);
  if (!mRows[0]) return res.status(404).json({ error: 'Market not found' });
  if (mRows[0].status !== 'open') return res.status(400).json({ error: 'Market is not open' });
  const market = mRows[0];
  const { rows: uRows } = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
  const user = uRows[0];
  if (parseFloat(user.balance) < amount) return res.status(400).json({ error: 'Insufficient balance' });
  const price = outcome === 'YES' ? parseFloat(market.yes_price) : parseFloat(market.no_price);
  const shares = parseFloat((amount / price).toFixed(2));
  const avgPrice = parseFloat((amount / shares).toFixed(4));
  const newBalance = parseFloat((parseFloat(user.balance) - amount).toFixed(2));
  const newYesShares = outcome === 'YES' ? parseFloat(market.total_shares_yes) + shares : parseFloat(market.total_shares_yes);
  const newNoShares = outcome === 'NO' ? parseFloat(market.total_shares_no) + shares : parseFloat(market.total_shares_no);
  const total = newYesShares + newNoShares;
  const newYesPrice = parseFloat((newYesShares / total).toFixed(4));
  const newNoPrice = parseFloat((newNoShares / total).toFixed(4));
  const newVolume = parseFloat(market.volume) + amount;
  const newLiquidity = parseFloat(market.liquidity) + amount * 0.02;
  await pool.query('UPDATE users SET balance=$1 WHERE id=$2', [newBalance, user.id]);
  await pool.query('UPDATE markets SET total_shares_yes=$1,total_shares_no=$2,yes_price=$3,no_price=$4,volume=$5,liquidity=$6 WHERE id=$7',
    [newYesShares, newNoShares, newYesPrice, newNoPrice, newVolume, newLiquidity, marketId]);
  const tradeId = uuidv4();
  await pool.query('INSERT INTO trades (id,user_id,market_id,outcome,shares,price,amount,type) VALUES ($1,$2,$3,$4,$5,$6,$7,\'buy\')',
    [tradeId, user.id, marketId, outcome, shares, avgPrice, amount]);
  await pool.query(`INSERT INTO positions (id,user_id,market_id,outcome,shares,avg_price) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (user_id,market_id,outcome) DO UPDATE SET shares=positions.shares+$5, avg_price=((positions.avg_price*positions.shares)+($5*$6))/(positions.shares+$5)`,
    [uuidv4(), user.id, marketId, outcome, shares, avgPrice]);
  res.json({ success: true, trade: { id: tradeId, shares, price: avgPrice, amount, outcome, type: 'buy' }, user: { ...user, balance: newBalance }, market: { yesPrice: newYesPrice, noPrice: newNoPrice, volume: newVolume } });
});

app.post('/api/trade/sell', authMiddleware, async (req, res) => {
  const { marketId, outcome, shares } = req.body;
  if (!marketId || !outcome || !shares || shares <= 0) return res.status(400).json({ error: 'Invalid parameters' });
  const { rows: pRows } = await pool.query('SELECT * FROM positions WHERE user_id=$1 AND market_id=$2 AND outcome=$3', [req.user.id, marketId, outcome]);
  if (!pRows[0] || parseFloat(pRows[0].shares) < shares) return res.status(400).json({ error: 'Insufficient shares' });
  const { rows: mRows } = await pool.query('SELECT * FROM markets WHERE id=$1', [marketId]);
  const market = mRows[0];
  const price = outcome === 'YES' ? parseFloat(market.yes_price) : parseFloat(market.no_price);
  const proceeds = parseFloat((shares * price * 0.98).toFixed(2));
  const { rows: uRows } = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
  const newBalance = parseFloat((parseFloat(uRows[0].balance) + proceeds).toFixed(2));
  const newYesShares = outcome === 'YES' ? Math.max(0, parseFloat(market.total_shares_yes) - shares) : parseFloat(market.total_shares_yes);
  const newNoShares = outcome === 'NO' ? Math.max(0, parseFloat(market.total_shares_no) - shares) : parseFloat(market.total_shares_no);
  const total = newYesShares + newNoShares;
  const newYesPrice = parseFloat((newYesShares / total).toFixed(4));
  const newNoPrice = parseFloat((newNoShares / total).toFixed(4));
  await pool.query('UPDATE users SET balance=$1 WHERE id=$2', [newBalance, req.user.id]);
  await pool.query('UPDATE markets SET total_shares_yes=$1,total_shares_no=$2,yes_price=$3,no_price=$4 WHERE id=$5', [newYesShares, newNoShares, newYesPrice, newNoPrice, marketId]);
  const newShares = parseFloat(pRows[0].shares) - shares;
  if (newShares <= 0) await pool.query('DELETE FROM positions WHERE user_id=$1 AND market_id=$2 AND outcome=$3', [req.user.id, marketId, outcome]);
  else await pool.query('UPDATE positions SET shares=$1 WHERE user_id=$2 AND market_id=$3 AND outcome=$4', [newShares, req.user.id, marketId, outcome]);
  const tradeId = uuidv4();
  await pool.query('INSERT INTO trades (id,user_id,market_id,outcome,shares,price,amount,type) VALUES ($1,$2,$3,$4,$5,$6,$7,\'sell\')', [tradeId, req.user.id, marketId, outcome, shares, price, proceeds]);
  res.json({ success: true, proceeds, user: { balance: newBalance }, market: { yesPrice: newYesPrice, noPrice: newNoPrice } });
});

app.get('/api/portfolio', authMiddleware, async (req, res) => {
  const { rows: positions } = await pool.query('SELECT p.*,m.title,m.category,m.yes_price,m.no_price,m.status FROM positions p JOIN markets m ON p.market_id=m.id WHERE p.user_id=$1', [req.user.id]);
  const enriched = positions.map(p => {
    const currentPrice = p.outcome === 'YES' ? parseFloat(p.yes_price) : parseFloat(p.no_price);
    const shares = parseFloat(p.shares);
    const avgPrice = parseFloat(p.avg_price);
    const currentValue = parseFloat((shares * currentPrice).toFixed(2));
    const costBasis = parseFloat((shares * avgPrice).toFixed(2));
    const pnl = parseFloat((currentValue - costBasis).toFixed(2));
    return { ...p, currentPrice, currentValue, costBasis, pnl, pnlPct: costBasis > 0 ? parseFloat(((pnl / costBasis) * 100).toFixed(2)) : 0, market: { id: p.market_id, title: p.title, category: p.category, yesPrice: parseFloat(p.yes_price), noPrice: parseFloat(p.no_price), status: p.status } };
  });
  const { rows: uRows } = await pool.query('SELECT balance FROM users WHERE id=$1', [req.user.id]);
  const { rows: trades } = await pool.query('SELECT * FROM trades WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [req.user.id]);
  const totalValue = enriched.reduce((s, p) => s + p.currentValue, 0);
  const totalCost = enriched.reduce((s, p) => s + p.costBasis, 0);
  const totalPnl = parseFloat((totalValue - totalCost).toFixed(2));
  res.json({ positions: enriched, trades: trades.map(formatTrade), summary: { balance: parseFloat(uRows[0].balance), totalValue: parseFloat(totalValue.toFixed(2)), totalCost: parseFloat(totalCost.toFixed(2)), totalPnl, totalPnlPct: totalCost > 0 ? parseFloat(((totalPnl / totalCost) * 100).toFixed(2)) : 0 } });
});

app.get('/api/leaderboard', async (req, res) => {
  const { rows: users } = await pool.query('SELECT id,username,balance,created_at FROM users');
  const board = await Promise.all(users.map(async u => {
    const { rows: pos } = await pool.query('SELECT p.shares,p.outcome,m.yes_price,m.no_price FROM positions p JOIN markets m ON p.market_id=m.id WHERE p.user_id=$1', [u.id]);
    const posValue = pos.reduce((s, p) => s + parseFloat(p.shares) * parseFloat(p.outcome === 'YES' ? p.yes_price : p.no_price), 0);
    const { rows: t } = await pool.query('SELECT COUNT(*) FROM trades WHERE user_id=$1', [u.id]);
    return { id: u.id, username: u.username, balance: parseFloat(u.balance), portfolioValue: parseFloat((parseFloat(u.balance) + posValue).toFixed(2)), totalTrades: parseInt(t[0].count), joined: u.created_at };
  }));
  res.json(board.sort((a, b) => b.portfolioValue - a.portfolioValue).slice(0, 50));
});

app.get('/api/stats', async (req, res) => {
  const [markets, users, trades] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM markets WHERE status=$1', ['open']),
    pool.query('SELECT COUNT(*) FROM users'),
    pool.query('SELECT COUNT(*), COALESCE(SUM(amount),0) as vol FROM trades')
  ]);
  res.json({ openMarkets: parseInt(markets.rows[0].count), totalUsers: parseInt(users.rows[0].count), totalTrades: parseInt(trades.rows[0].count), totalVolume: parseFloat(trades.rows[0].vol).toFixed(2) });
});

app.post('/api/markets/:id/resolve', authMiddleware, async (req, res) => {
  const { outcome } = req.body;
  if (!['YES', 'NO'].includes(outcome)) return res.status(400).json({ error: 'Invalid outcome' });
  await pool.query('UPDATE markets SET status=\'resolved\',resolution=$1 WHERE id=$2', [outcome, req.params.id]);
  const { rows: winners } = await pool.query('SELECT * FROM positions WHERE market_id=$1 AND outcome=$2', [req.params.id, outcome]);
  for (const p of winners) await pool.query('UPDATE users SET balance=balance+$1 WHERE id=$2', [parseFloat(p.shares), p.user_id]);
  await pool.query('DELETE FROM positions WHERE market_id=$1', [req.params.id]);
  res.json({ success: true, winnersCount: winners.length });
});

function formatMarket(m) {
  return { id: m.id, title: m.title, description: m.description, category: m.category, asset: m.asset, yesPrice: parseFloat(m.yes_price), noPrice: parseFloat(m.no_price), volume: parseFloat(m.volume), liquidity: parseFloat(m.liquidity), endDate: m.end_date, status: m.status, resolution: m.resolution, resolutionSource: m.resolution_source, createdAt: m.created_at, totalShares: { YES: parseFloat(m.total_shares_yes), NO: parseFloat(m.total_shares_no) } };
}

function formatTrade(t) {
  return { id: t.id, userId: t.user_id, marketId: t.market_id, outcome: t.outcome, shares: parseFloat(t.shares), price: parseFloat(t.price), amount: parseFloat(t.amount), type: t.type, createdAt: t.created_at };
}

async function start() {
  await initDB();
  await seedMarkets();
  app.listen(PORT, () => { console.log(`🚀 PredictX running on port ${PORT}`); });
}

start();
