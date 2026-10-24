# ◈ PredictX — Crypto & Finance Prediction Market Exchange

A full-stack prediction market platform built with React + Node.js.

## Quick Start

### Prerequisites
- Node.js 16+ installed (https://nodejs.org)

### 1. Start the Backend
```bash
cd backend
npm install
node server.js
# Runs on http://localhost:4000
```

### 2. Start the Frontend (new terminal)
```bash
cd frontend
npm install
npm start
# Opens http://localhost:3000
```

That's it! The app will open automatically in your browser.

## Features
- 🔐 User auth (JWT) — new users get $1,000 play money
- 📊 6 seeded crypto/finance markets
- 💹 AMM pricing engine (Constant Product Market Maker)
- 📈 Buy & Sell shares with live price impact
- 💼 Portfolio tracking with P&L
- 🏆 Leaderboard
- ➕ Create custom markets
- ✅ Admin market resolution + payout

## Production Deployment

| Service | Purpose |
|---------|---------|
| Render / Railway | Backend (Node.js) |
| Vercel / Netlify | Frontend (React) |
| PostgreSQL (Supabase) | Replace in-memory DB |

### Environment Variables
**Backend:**
```
PORT=4000
JWT_SECRET=your-super-secret-key
FRONTEND_URL=https://your-frontend.vercel.app
```

**Frontend:**
```
REACT_APP_API_URL=https://your-backend.render.com/api
```

## How Markets Work
- Each share costs between 1¢–99¢ (= probability)
- Winning shares pay out **$1.00** at resolution
- Prices update via AMM as people trade
- 2% fee on sells

