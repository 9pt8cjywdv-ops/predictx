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

// ─── In-Memory Database ────────────────────────────────────────────────────
// Replace with PostgreSQL/MongoDB in production
const db = {
  users: [],
  markets: [],
  positions: [],  // { id, userId, marketId, outcome, shares, avgPrice, createdAt }
  orders: [],     // { id, userId, marketId, outcome, side, price, amount, filled, status, createdAt }
  trades: [],     // { id, buyOrderId, sellOrderId, marketId, outcome, price, amount, createdAt }
  orderBooks: {}  // marketId -> { YES: [...], NO: [...] }
};

// ─── Seed Markets ──────────────────────────────────────────────────────────
const seedMarkets = [
  {
    id: uuidv4(),
    title: 'Will Bitcoin exceed $150,000 by end of 2025?',
    description: 'Resolves YES if BTC/USD price on any major exchange (Coinbase, Binance, Kraken) exceeds $150,000 at any point before December 31, 2025 23:59 UTC.',
    category: 'Crypto',
    asset: 'BTC',
    yesPrice: 0.62,
    noPrice: 0.38,
    volume: 2840000,
    liquidity: 480000,
    endDate: '2025-12-31',
    status: 'open',
    resolutionSource: 'CoinGecko API',
    createdAt: new Date(Date.now() - 7 * 86400000).toISOString(),
    totalShares: { YES: 180000, NO: 110000 }
  },
  {
    id: uuidv4(),
    title: 'Will Ethereum flip Bitcoin in market cap before 2026?',
    description: 'Resolves YES if ETH market cap surpasses BTC market cap (the "flippening") at any point before January 1, 2026.',
    category: 'Crypto',
    asset: 'ETH',
    yesPrice: 0.18,
    noPrice: 0.82,
    volume: 1920000,
    liquidity: 310000,
    endDate: '2025-12-31',
    status: 'open',
    resolutionSource: 'CoinGecko API',
    createdAt: new Date(Date.now() - 14 * 86400000).toISOString(),
    totalShares: { YES: 55000, NO: 250000 }
  },
  {
    id: uuidv4(),
    title: 'Will the Fed cut rates at least 3 times in 2025?',
    description: 'Resolves YES if the Federal Reserve announces 3 or more interest rate cuts (of any size) at FOMC meetings in calendar year 2025.',
    category: 'Finance',
    asset: 'RATES',
    yesPrice: 0.44,
    noPrice: 0.56,
    volume: 3100000,
    liquidity: 620000,
    endDate: '2025-12-15',
    status: 'open',
    resolutionSource: 'Federal Reserve Official Statements',
    createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    totalShares: { YES: 135000, NO: 172000 }
  },
  {
    id: uuidv4(),
    title: 'Will Solana surpass $500 before July 2025?',
    description: 'Resolves YES if SOL/USD price on any major exchange exceeds $500 at any point before July 1, 2025 00:00 UTC.',
    category: 'Crypto',
    asset: 'SOL',
    yesPrice: 0.31,
    noPrice: 0.69,
    volume: 980000,
    liquidity: 195000,
    endDate: '2025-06-30',
    status: 'open',
    resolutionSource: 'CoinGecko API',
    createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    totalShares: { YES: 78000, NO: 173000 }
  },
  {
    id: uuidv4(),
    title: 'Will S&P 500 reach 7,000 points in 2025?',
    description: 'Resolves YES if the S&P 500 index closes above 7,000 on any trading day in 2025.',
    category: 'Finance',
    asset: 'SPX',
    yesPrice: 0.71,
    noPrice: 0.29,
    volume: 4200000,
    liquidity: 890000,
    endDate: '2025-12-31',
    status: 'open',
    resolutionSource: 'NYSE Official Data',
    createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
    totalShares: { YES: 225000, NO: 92000 }
  },
  {
    id: uuidv4(),
    title: 'Will a spot Solana ETF be approved in the US in 2025?',
    description: 'Resolves YES if the SEC approves at least one spot Solana ETF application for trading on a US exchange before December 31, 2025.',
    category: 'Crypto',
    asset: 'SOL',
    yesPrice: 0.55,
    noPrice: 0.45,
    volume: 1650000,
    liquidity: 340000,
    endDate: '2025-12-31',
    status: 'open',
    resolutionSource: 'SEC.gov Official Announcements',
    createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    totalShares: { YES: 165000, NO: 135000 }
  }
];

db.markets = seedMarkets;
seedMarkets.forEach(m => {
  db.orderBooks[m.id] = { YES: [], NO: [] };
});

// ─── Middleware: Auth ──────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ─── CPMM Pricing (Constant Product Market Maker) ─────────────────────────
function recalcPrices(market) {
  const yes = market.totalShares.YES;
  const no = market.totalShares.NO;
  const total = yes + no;
  if (total === 0) return;
  // Simple CPMM: price proportional to share distribution
  market.yesPrice = parseFloat((yes / total).toFixed(4));
  market.noPrice = parseFloat((no / total).toFixed(4));
}

function calculateShares(market, outcome, usdAmount) {
  // Automated Market Maker: shares bought = amount / current_price
  const price = outcome === 'YES' ? market.yesPrice : market.noPrice;
  const shares = usdAmount / price;
  return parseFloat(shares.toFixed(2));
}

function getImpactedPrice(market, outcome, shares) {
  const k = market.totalShares.YES * market.totalShares.NO;
  if (outcome === 'YES') {
    const newYes = market.totalShares.YES + shares;
    const newNo = k / newYes;
    const total = newYes + newNo;
    return parseFloat((newYes / total).toFixed(4));
  } else {
    const newNo = market.totalShares.NO + shares;
    const newYes = k / newNo;
    const total = newYes + newNo;
    return parseFloat((newNo / total).toFixed(4));
  }
}

// ─── AUTH ROUTES ──────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: 'All fields required' });

  if (db.users.find(u => u.email === email))
    return res.status(400).json({ error: 'Email already registered' });

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = {
    id: uuidv4(),
    username,
    email,
    password: hashedPassword,
    balance: 1000.00,  // Start with $1,000 play money
    createdAt: new Date().toISOString()
  };
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

// ─── MARKET ROUTES ────────────────────────────────────────────────────────
app.get('/api/markets', (req, res) => {
  const { category, status, search } = req.query;
  let markets = db.markets;
  if (category && category !== 'All') markets = markets.filter(m => m.category === category);
  if (status) markets = markets.filter(m => m.status === status);
  if (search) markets = markets.filter(m =>
    m.title.toLowerCase().includes(search.toLowerCase()) ||
    m.description.toLowerCase().includes(search.toLowerCase())
  );
  res.json(markets);
});

app.get('/api/markets/:id', (req, res) => {
  const market = db.markets.find(m => m.id === req.params.id);
  if (!market) return res.status(404).json({ error: 'Market not found' });

  const trades = db.trades
    .filter(t => t.marketId === req.params.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 50);

  res.json({ ...market, recentTrades: trades });
});

app.post('/api/markets', authMiddleware, (req, res) => {
  const { title, description, category, asset, endDate, resolutionSource } = req.body;
  if (!title || !description || !category || !endDate)
    return res.status(400).json({ error: 'Missing required fields' });

  const market = {
    id: uuidv4(),
    title,
    description,
    category,
    asset: asset || 'CUSTOM',
    yesPrice: 0.50,
    noPrice: 0.50,
    volume: 0,
    liquidity: 0,
    endDate,
    status: 'open',
    resolutionSource: resolutionSource || 'Admin Decision',
    createdBy: req.user.id,
    createdAt: new Date().toISOString(),
    totalShares: { YES: 1000, NO: 1000 }
  };
  db.markets.push(market);
  db.orderBooks[market.id] = { YES: [], NO: [] };
  res.status(201).json(market);
});

// ─── TRADING ROUTES ───────────────────────────────────────────────────────
app.post('/api/trade', authMiddleware, (req, res) => {
  const { marketId, outcome, amount } = req.body;
  if (!marketId || !outcome || !amount || amount <= 0)
    return res.status(400).json({ error: 'Invalid trade parameters' });
  if (!['YES', 'NO'].includes(outcome))
    return res.status(400).json({ error: 'Outcome must be YES or NO' });

  const market = db.markets.find(m => m.id === marketId);
  if (!market) return res.status(404).json({ error: 'Market not found' });
  if (market.status !== 'open') return res.status(400).json({ error: 'Market is not open' });

  const user = db.users.find(u => u.id === req.user.id);
  if (user.balance < amount) return res.status(400).json({ error: 'Insufficient balance' });

  // Calculate shares using AMM
  const currentPrice = outcome === 'YES' ? market.yesPrice : market.noPrice;
  const shares = calculateShares(market, outcome, amount);
  const avgPrice = parseFloat((amount / shares).toFixed(4));

  // Execute trade
  user.balance = parseFloat((user.balance - amount).toFixed(2));
  market.totalShares[outcome] += shares;
  market.volume += amount;
  market.liquidity = parseFloat((market.liquidity + amount * 0.02).toFixed(2)); // 2% to liquidity
  recalcPrices(market);

  // Record trade
  const trade = {
    id: uuidv4(),
    userId: user.id,
    marketId,
    outcome,
    shares: parseFloat(shares.toFixed(2)),
    price: avgPrice,
    amount: parseFloat(amount.toFixed(2)),
    type: 'buy',
    createdAt: new Date().toISOString()
  };
  db.trades.push(trade);

  // Update or create position
  let position = db.positions.find(p => p.userId === user.id && p.marketId === marketId && p.outcome === outcome);
  if (position) {
    const totalCost = position.avgPrice * position.shares + amount;
    position.shares += shares;
    position.avgPrice = parseFloat((totalCost / position.shares).toFixed(4));
  } else {
    position = {
      id: uuidv4(),
      userId: user.id,
      marketId,
      outcome,
      shares: parseFloat(shares.toFixed(2)),
      avgPrice,
      createdAt: new Date().toISOString()
    };
    db.positions.push(position);
  }

  const { password: _, ...userPublic } = user;
  res.json({
    success: true,
    trade,
    position,
    user: userPublic,
    market: { yesPrice: market.yesPrice, noPrice: market.noPrice, volume: market.volume }
  });
});

app.post('/api/trade/sell', authMiddleware, (req, res) => {
  const { marketId, outcome, shares } = req.body;
  if (!marketId || !outcome || !shares || shares <= 0)
    return res.status(400).json({ error: 'Invalid sell parameters' });

  const market = db.markets.find(m => m.id === marketId);
  if (!market) return res.status(404).json({ error: 'Market not found' });
  if (market.status !== 'open') return res.status(400).json({ error: 'Market is not open' });

  const position = db.positions.find(p =>
    p.userId === req.user.id && p.marketId === marketId && p.outcome === outcome
  );
  if (!position || position.shares < shares)
    return res.status(400).json({ error: 'Insufficient shares' });

  const user = db.users.find(u => u.id === req.user.id);
  const currentPrice = outcome === 'YES' ? market.yesPrice : market.noPrice;
  const proceeds = parseFloat((shares * currentPrice * 0.98).toFixed(2)); // 2% fee

  // Execute sell
  user.balance = parseFloat((user.balance + proceeds).toFixed(2));
  market.totalShares[outcome] = Math.max(0, market.totalShares[outcome] - shares);
  market.volume += proceeds;
  recalcPrices(market);
  position.shares = parseFloat((position.shares - shares).toFixed(2));

  // Remove position if empty
  if (position.shares <= 0) {
    db.positions = db.positions.filter(p => p.id !== position.id);
  }

  const trade = {
    id: uuidv4(),
    userId: user.id,
    marketId,
    outcome,
    shares,
    price: currentPrice,
    amount: proceeds,
    type: 'sell',
    createdAt: new Date().toISOString()
  };
  db.trades.push(trade);

  const { password: _, ...userPublic } = user;
  res.json({ success: true, trade, proceeds, user: userPublic, market: { yesPrice: market.yesPrice, noPrice: market.noPrice } });
});

// ─── PORTFOLIO ROUTES ─────────────────────────────────────────────────────
app.get('/api/portfolio', authMiddleware, (req, res) => {
  const userPositions = db.positions.filter(p => p.userId === req.user.id);

  const enriched = userPositions.map(p => {
    const market = db.markets.find(m => m.id === p.marketId);
    const currentPrice = market ? (p.outcome === 'YES' ? market.yesPrice : market.noPrice) : p.avgPrice;
    const currentValue = parseFloat((p.shares * currentPrice).toFixed(2));
    const costBasis = parseFloat((p.shares * p.avgPrice).toFixed(2));
    const pnl = parseFloat((currentValue - costBasis).toFixed(2));
    const pnlPct = costBasis > 0 ? parseFloat(((pnl / costBasis) * 100).toFixed(2)) : 0;

    return {
      ...p,
      market: market ? {
        id: market.id, title: market.title, category: market.category,
        yesPrice: market.yesPrice, noPrice: market.noPrice, status: market.status
      } : null,
      currentPrice,
      currentValue,
      costBasis,
      pnl,
      pnlPct
    };
  });

  const totalValue = enriched.reduce((sum, p) => sum + p.currentValue, 0);
  const totalCost = enriched.reduce((sum, p) => sum + p.costBasis, 0);
  const totalPnl = parseFloat((totalValue - totalCost).toFixed(2));

  const user = db.users.find(u => u.id === req.user.id);
  const trades = db.trades
    .filter(t => t.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 100);

  res.json({
    positions: enriched,
    trades,
    summary: {
      balance: user.balance,
      totalValue: parseFloat(totalValue.toFixed(2)),
      totalCost: parseFloat(totalCost.toFixed(2)),
      totalPnl,
      totalPnlPct: totalCost > 0 ? parseFloat(((totalPnl / totalCost) * 100).toFixed(2)) : 0
    }
  });
});

// ─── LEADERBOARD ──────────────────────────────────────────────────────────
app.get('/api/leaderboard', (req, res) => {
  const leaderboard = db.users
    .map(u => {
      const positions = db.positions.filter(p => p.userId === u.id);
      const positionsValue = positions.reduce((sum, p) => {
        const market = db.markets.find(m => m.id === p.marketId);
        const price = market ? (p.outcome === 'YES' ? market.yesPrice : market.noPrice) : p.avgPrice;
        return sum + p.shares * price;
      }, 0);
      const totalTrades = db.trades.filter(t => t.userId === u.id).length;
      return {
        id: u.id,
        username: u.username,
        balance: u.balance,
        portfolioValue: parseFloat((u.balance + positionsValue).toFixed(2)),
        totalTrades,
        joined: u.createdAt
      };
    })
    .sort((a, b) => b.portfolioValue - a.portfolioValue)
    .slice(0, 50);
  res.json(leaderboard);
});

// ─── ADMIN: RESOLVE MARKET ────────────────────────────────────────────────
app.post('/api/markets/:id/resolve', authMiddleware, (req, res) => {
  const { outcome } = req.body; // 'YES' or 'NO'
  if (!['YES', 'NO'].includes(outcome))
    return res.status(400).json({ error: 'Outcome must be YES or NO' });

  const market = db.markets.find(m => m.id === req.params.id);
  if (!market) return res.status(404).json({ error: 'Market not found' });
  if (market.status !== 'open') return res.status(400).json({ error: 'Market already resolved' });

  market.status = 'resolved';
  market.resolution = outcome;
  market.resolvedAt = new Date().toISOString();

  // Pay out winners
  const winnerPositions = db.positions.filter(
    p => p.marketId === market.id && p.outcome === outcome
  );
  winnerPositions.forEach(p => {
    const user = db.users.find(u => u.id === p.userId);
    if (user) {
      user.balance = parseFloat((user.balance + p.shares).toFixed(2)); // $1 per winning share
    }
  });

  // Remove all positions for this market
  db.positions = db.positions.filter(p => p.marketId !== market.id);

  res.json({ success: true, market, winnersCount: winnerPositions.length });
});

// ─── STATS ────────────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  res.json({
    totalMarkets: db.markets.length,
    openMarkets: db.markets.filter(m => m.status === 'open').length,
    totalVolume: db.trades.reduce((sum, t) => sum + t.amount, 0).toFixed(2),
    totalUsers: db.users.length,
    totalTrades: db.trades.length
  });
});

app.listen(PORT, () => {
  console.log(`🚀 PredictX Backend running on http://localhost:${PORT}`);
  console.log(`📊 ${db.markets.length} markets loaded`);
});

module.exports = app;
