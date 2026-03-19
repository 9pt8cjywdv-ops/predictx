const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      email VARCHAR(100) UNIQUE NOT NULL,
      password VARCHAR(100) NOT NULL,
      balance DECIMAL(12,2) DEFAULT 1000.00,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS markets (
      id UUID PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      category VARCHAR(50),
      asset VARCHAR(20),
      yes_price DECIMAL(6,4) DEFAULT 0.50,
      no_price DECIMAL(6,4) DEFAULT 0.50,
      volume DECIMAL(15,2) DEFAULT 0,
      liquidity DECIMAL(15,2) DEFAULT 0,
      end_date VARCHAR(20),
      status VARCHAR(20) DEFAULT 'open',
      resolution VARCHAR(10),
      resolution_source TEXT,
      created_by UUID,
      total_shares_yes DECIMAL(15,2) DEFAULT 1000,
      total_shares_no DECIMAL(15,2) DEFAULT 1000,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS trades (
      id UUID PRIMARY KEY,
      user_id UUID REFERENCES users(id),
      market_id UUID REFERENCES markets(id),
      outcome VARCHAR(5),
      shares DECIMAL(15,4),
      price DECIMAL(6,4),
      amount DECIMAL(12,2),
      type VARCHAR(10),
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS positions (
      id UUID PRIMARY KEY,
      user_id UUID REFERENCES users(id),
      market_id UUID REFERENCES markets(id),
      outcome VARCHAR(5),
      shares DECIMAL(15,4),
      avg_price DECIMAL(6,4),
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, market_id, outcome)
    );
  `);
  console.log('✅ Database tables ready');
}

module.exports = { pool, initDB };
