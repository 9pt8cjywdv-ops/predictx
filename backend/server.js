const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }));
app.use(express.json());

const db = { users: [], markets: [], positions: [], orders: [], trades: [], orderBooks: {} };

const seedMarkets = [
  { id: uuidv4(), title: 'Will Bitcoin exceed $200,000 by end of 2026?', description: 'Resolves YES if BTC/USD price on any major exchange (Coinbase, Binance, Kraken) exceeds $200,000 at any point before December 31, 2026 23:59 UTC.', category: 'Crypto', asset: 'BTC', yesPrice: 0.58, noPrice: 0.42, volume: 3200000, liquidity: 520000, endDate: '2026-12-31', status: 'open', resolutionSource: 'CoinGecko API', createdAt: new Date(Date.now() - 7 * 86400000).toISOString(), totalShares: { YES: 175000, NO: 128000 } },
  { id: uuidv4(), title: 'Will Ethereum reach $10,000 in 2026?', description: 'Resolves YES if ETH/USD price on any major exchange exceeds $10,000 at any point before December 31, 2026 23:59 UTC.', category: 'Crypto', asset: 'ETH', yesPrice: 0.42, noPrice: 0.58, volume: 1750000, liquidity: 290000, endDate: '2026-12-31', status: 'open', resolutionSource: 'CoinGecko API', createdAt: new Date(Date.now() - 14 * 86400000).toISOString(), totalShares: { YES: 95000, NO: 132000 } },
  { id: uuidv4(), title: 'Will the Fed cut rates at least 2 times in 2026?', description: 'Resolves YES if the Federal Reserve announces 2 or more interest rate cuts at FOMC meetings in calendar year 2026.', category: 'Finance', asset: 'RATES', yesPrice: 0.61, noPrice: 0.39, volume: 2800000, liquidity: 540000, endDate: '2026-12-15', status: 'open', resolutionSource: 'Federal Reserve Official Statements', createdAt: new Date(Date.now() - 3 * 86400000).toISOString(), totalShares: { YES: 158000, NO: 101000 } },
  { id: uuidv4(), title: 'Will Solana surpass $500 before July 2026?', description: 'Resolves YES if SOL/USD price on any major exchange exceeds $500 at any point before July 1, 2026 00:00 UTC.', category: 'Crypto', asset: 'SOL', yesPrice: 0.38, noPrice: 0.62, volume: 1100000, liquidity: 210000, endDate: '2026-06-30', status: 'open', resolutionSource: 'CoinGecko API', createdAt: new Date(Date.now() - 5 * 86400000).toISOString(), totalShares: { YES: 88000, NO: 144000 } },
  { id: uuidv4(), title: 'Will S&P 500 reach 7,500 points in 2026?', description: 'Resolves YES if the S&P 500 index closes above 7,500 on any trading day in calendar year 2026.', category: 'Finance', asset: 'SPX', yesPrice: 0.64, noPrice: 0.36, volume: 4800000, liquidity: 960000, endDate: '2026-12-31', status: 'open', resolutionSource: 'NYSE Official Data', createdAt: new Date(Date.now() - 10 * 86400000).toISOString(), totalShares: { YES: 210000, NO: 118000 } },
  { id: uuidv4(), title: 'Will a spot Solana ETF be approved in the US in 2026?', description: 'Resolves YES if the SEC approves at least one spot Solana ETF application for trading on a US exchange before December 31, 2026.', category: 'Crypto', asset: 'SOL', yesPrice: 0.67, noPrice: 0.33, volume: 1950000, liquidity: 380000, endDate: '2026-12-31', status: 'open', resolutionSource: 'SEC.gov Official Announcements', createdAt: new Date(Date.now() - 2 * 86400000).toISOString(), totalShares: { YES: 188000, NO: 92000 } },
  { id: uuidv4(), title: 'Will Bitcoin dominance drop below 40% in 2026?', description: 'Resolves YES if Bitcoin market cap dominance drops below 40% on CoinGecko at any point before December 31, 2026.', category: 'Crypto', asset: 'BTC.D', yesPrice: 0.33, noPrice: 0.67, volume: 870000, liquidity: 165000, endDate: '2026-12-31', status: 'open', resolutionSource: 'CoinGecko API', createdAt: new Date(Date.now() - 1 * 86400000).toISOString(), totalShares: { YES: 72000, NO: 146000 } },
  { id: uuidv4(), title: 'Will US inflation drop below 2% by end of 2026?', description: 'Resolves YES if the US CPI year-over-year inflation rate drops below 2.0% in any monthly BLS report published before December 31, 2026.', category: 'Finance', asset: 'CPI', yesPrice: 0.45, noPrice: 0.55, volume: 1420000, liquidity: 280000, endDate: '2026-12-31', status: 'open', resolutionSource: 'Bureau of Labor Statistics', createdAt: new Date(Date.now() - 4 * 86400000).toISOString(), totalShares: { YES: 112000, NO: 137000 } }
];

db.markets = seedMarkets;
seedMarkets.forEach(m => { db.orderBooks[m.id] = { YES: [], NO: [] }; });

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

function recalcPrices(market) {
  const yes = market.totalShares.YES, no = market.totalShares.NO, total = yes + no;
  if (total === 0) return;
  market.yesPrice = parseFloat((yes / total).toFixed(4));
  market.noPrice = parseFloat((no / total).toFixed(4));
}

function calculateShares(market, outcome, usdAmount) {
  const price = outcome === 'YES' ? market.yesPrice : market.noPrice;
  return parseFloat((usdAmount / price).toFixed(2));
}

app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
  if (db.users.find(u => u.email === email)) return res.status(400).json({ error: 'Email already registered' });
  const hashedPassword = await bcrypt.hash(password, 10);
  const user = { id: uuidv4(), username, email, password: hashedPassword, balance: 1000.00, createdAt: new Date().toISOString() };
  db.users.push(user);
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  const { password: _, ...userPublic } = user;
  res.json({ token, user: userPublic });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.users.find(u => u.email === email);
  if (!user) return res.status(400).json({ error: 'Invalid credentials' });
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  const { password: _, ...userPublic } = user;
  res.json({ token, user: userPublic });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { password: _, ...userPublic } = user;
  res.json(userPublic);
});

app.get('/api/markets', (req, res) => {
  const { category, status, search } = req.query;
  let markets = db.markets;
  if (category && category !== 'All') markets = markets.filter(m => m.category === category);
  if (status) markets = markets.filter(m => m.status === status);
  if (search) markets = markets.filter(m => m.title.toLowerCase().includes(search.toLowerCase()));
  res.json(markets);
});

app.get('/api/markets/:id', (req, res) => {
  const market = db.markets.find(m => m.id === req.params.id);
  if (!market) return res.status(404).json({ error: 'Market not found' });
  const trades = db.trades.filter(t => t.marketId === req.params.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 50);
  res.json({ ...market, recentTrades: trades });
});

app.post('/api/markets', authMiddleware, (req, res) => {
  const { title, description, category, asset, endDate, resolutionSource } = req.body;
  if (!title || !description || !category || !endDate) return res.status(400).json({ error: 'Missing required fields' });
  const market = { id: uuidv4(), title, description, category, asset: asset || 'CUSTOM', yesPrice: 0.50, noPrice: 0.50, volume: 0, liquidity: 0, endDate, status: 'open', resolutionSource: resolutionSource || 'Admin Decision', createdBy: req.user.id, createdAt: new Date().toISOString(), totalShares: { YES: 1000, NO: 1000 } };
  db.markets.push(market);
  db.orderBooks[market.id] = { YES: [], NO: [] };
  res.status(201).json(market);
});

app.post('/api/trade', authMiddleware, (req, res) => {
  const { marketId, outcome, amount } = req.body;
  if (!marketId || !outcome || !amount || amount <= 0) return res.status(400).json({ error: 'Invalid trade parameters' });
  if (!['YES', 'NO'].includes(outcome)) return res.status(400).json({ error: 'Outcome must be YES or NO' });
  const market = db.markets.find(m => m.id === marketId);
  if (!market) return res.status(404).json({ error: 'Market not found' });
  if (market.status !== 'open') return res.status(400).json({ error: 'Market is not open' });
  const user = db.users.find(u => u.id === req.user.id);
  if (user.balance < amount) return res.status(400).json({ error: 'Insufficient balance' });
  const price = outcome === 'YES' ? market.yesPrice : market.noPrice;
  const shares = calculateShares(market, outcome, amount);
  const avgPrice = parseFloat((amount / shares).toFixed(4));
  user.balance = parseFloat((user.balance - amount).toFixed(2));
  market.totalShares[outcome] += shares;
  market.volume += amount;
  market.liquidity = parseFloat((market.liquidity + amount * 0.02).toFixed(2));
  recalcPrices(market);
  const trade = { id: uuidv4(), userId: user.id, marketId, outcome, shares: parseFloat(shares.toFixed(2)), price: avgPrice, amount: parseFloat(amount.toFixed(2)), type: 'buy', createdAt: new Date().toISOString() };
  db.trades.push(trade);
  let position = db.positions.find(p => p.userId === user.id && p.marketId === marketId && p.outcome === outcome);
  if (position) { const totalCost = position.avgPrice * position.shares + amount; position.shares += shares; position.avgPrice = parseFloat((totalCost / position.shares).toFixed(4)); }
  else { position = { id: uuidv4(), userId: user.id, marketId, outcome, shares: parseFloat(shares.toFixed(2)), avgPrice, createdAt: new Date().toISOString() }; db.positions.push(position); }
  const { password: _, ...userPublic } = user;
  res.json({ success: true, trade, position, user: userPublic, market: { yesPrice: market.yesPrice, noPrice: market.noPrice, volume: market.volume } });
});

app.post('/api/trade/sell', authMiddleware, (req, res) => {
  const { marketId, outcome, shares } = req.body;
  if (!marketId || !outcome || !shares || shares <= 0) return res.status(400).json({ error: 'Invalid sell parameters' });
  const market = db.markets.find(m => m.id === marketId);
  if (!market) return res.status(404).json({ error: 'Market not found' });
  if (market.status !== 'open') return res.status(400).json({ error: 'Market is not open' });
  const position = db.positions.find(p => p.userId === req.user.id && p.marketId === marketId && p.outcome === outcome);
  if (!position || position.shares < shares) return res.status(400).json({ error: 'Insufficient shares' });
  const user = db.users.find(u => u.id === req.user.id);
  const currentPrice = outcome === 'YES' ? market.yesPrice : market.noPrice;
  const proceeds = parseFloat((shares * currentPrice * 0.98).toFixed(2));
  user.balance = parseFloat((user.balance + proceeds).toFixed(2));
  market.totalShares[outcome] = Math.max(0, market.totalShares[outcome] - shares);
  market.volume += proceeds;
  recalcPrices(market);
  position.shares = parseFloat((position.shares - shares).toFixed(2));
  if (position.shares <= 0) db.positions = db.positions.filter(p => p.id !== position.id);
  const trade = { id: uuidv4(), userId: user.id, marketId, outcome, shares, price: currentPrice, amount: proceeds, type: 'sell', createdAt: new Date().toISOString() };
  db.trades.push(trade);
  const { password: _, ...userPublic } = user;
  res.json({ success: true, trade, proceeds, user: userPublic, market: { yesPrice: market.yesPrice, noPrice: market.noPrice } });
});

app.get('/api/portfolio', authMiddleware, (req, res) => {
  const userPositions = db.positions.filter(p => p.userId === req.user.id);
  const enriched = userPositions.map(p => {
    const market = db.markets.find(m => m.id === p.marketId);
    const currentPrice = market ? (p.outcome === 'YES' ? market.yesPrice : market.noPrice) : p.avgPrice;
    const currentValue = parseFloat((p.shares * currentPrice).toFixed(2));
    const costBasis = parseFloat((p.shares * p.avgPrice).toFixed(2));
    const pnl = parseFloat((currentValue - costBasis).toFixed(2));
    const pnlPct = costBasis > 0 ? parseFloat(((pnl / costBasis) * 100).toFixed(2)) : 0;
    return { ...p, market: market ? { id: market.id, title: market.title, category: market.category, yesPrice: market.yesPrice, noPrice: market.noPrice, status: market.status } : null, currentPrice, currentValue, costBasis, pnl, pnlPct };
  });
  const totalValue = enriched.reduce((sum, p) => sum + p.currentValue, 0);
  const totalCost = enriched.reduce((sum, p) => sum + p.costBasis, 0);
  const totalPnl = parseFloat((totalValue - totalCost).toFixed(2));
  const user = db.users.find(u => u.id === req.user.id);
  const trades = db.trades.filter(t => t.userId === req.user.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 100);
  res.json({ positions: enriched, trades, summary: { balance: user.balance, totalValue: parseFloat(totalValue.toFixed(2)), totalCost: parseFloat(totalCost.toFixed(2)), totalPnl, totalPnlPct: totalCost > 0 ? parseFloat(((totalPnl / totalCost) * 100).toFixed(2)) : 0 } });
});

app.get('/api/leaderboard', (req, res) => {
  const leaderboard = db.users.map(u => {
    const positions = db.positions.filter(p => p.userId === u.id);
    const positionsValue = positions.reduce((sum, p) => { const market = db.markets.find(m => m.id === p.marketId); const price = market ? (p.outcome === 'YES' ? market.yesPrice : market.noPrice) : p.avgPrice; return sum + p.shares * price; }, 0);
    return { id: u.id, username: u.username, balance: u.balance, portfolioValue: parseFloat((u.balance + positionsValue).toFixed(2)), totalTrades: db.trades.filter(t => t.userId === u.id).length, joined: u.createdAt };
  }).sort((a, b) => b.portfolioValue - a.portfolioValue).slice(0, 50);
  res.json(leaderboard);
});

app.post('/api/markets/:id/resolve', authMiddleware, (req, res) => {
  const { outcome } = req.body;
  if (!['YES', 'NO'].includes(outcome)) return res.status(400).json({ error: 'Outcome must be YES or NO' });
  const market = db.markets.find(m => m.id === req.params.id);
  if (!market) return res.status(404).json({ error: 'Market not found' });
  if (market.status !== 'open') return res.status(400).json({ error: 'Market already resolved' });
  market.status = 'resolved'; market.resolution = outcome; market.resolvedAt = new Date().toISOString();
  const winnerPositions = db.positions.filter(p => p.marketId === market.id && p.outcome === outcome);
  winnerPositions.forEach(p => { const user = db.users.find(u => u.id === p.userId); if (user) user.balance = parseFloat((user.balance + p.shares).toFixed(2)); });
  db.positions = db.positions.filter(p => p.marketId !== market.id);
  res.json({ success: true, market, winnersCount: winnerPositions.length });
});

app.get('/api/stats', (req, res) => {
  res.json({ totalMarkets: db.markets.length, openMarkets: db.markets.filter(m => m.status === 'open').length, totalVolume: db.trades.reduce((sum, t) => sum + t.amount, 0).toFixed(2), totalUsers: db.users.length, totalTrades: db.trades.length });
});

app.listen(PORT, () => { console.log(`🚀 PredictX Backend running on http://localhost:${PORT}`); console.log(`📊 ${db.markets.length} markets loaded`); });
module.exports = app;
