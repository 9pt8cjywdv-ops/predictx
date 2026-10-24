# PredictX Sports — Winner Probability Dashboard

Calibrated win probabilities for upcoming events in football (soccer), rugby union, tennis,
basketball, cricket, American football and baseball. The home screen answers one question:
**which upcoming event has the most likely winner, and how likely is it?**

> Probabilities are statistical estimates, never guarantees. The app has no betting features.
> The crypto prediction-market app that was here before is still in `backend/` and `frontend/`
> (see `LEGACY_PREDICTION_MARKET_README.md`).

```
                ┌──────────────────────── engine (Python) ─────────────────────────┐
 ESPN site API ─┤ sources/espn.py      fixtures, results, injuries   ┐             │
 The Odds API ──┤ sources/odds_api.py  bookmaker consensus (margin   ├─► PostgreSQL│
                │                      removed, median of books)     ┘     ▲       │
                │ worker.py (APScheduler) → pipeline.py:                   │       │
                │   grade finished → recalibrate → fit sport model → predict ┘     │
                │ api.py (FastAPI) /api/predictions /api/accuracy /api/meta        │
                └───────────────────────────────▲──────────────────────────────────┘
                                                │ server-side proxy (/api/engine/*)
                              web (Next.js + Tailwind, dark theme)
```

## Quick start (Docker)

```bash
cp engine/.env.example .env        # optionally add ODDS_API_KEY and ADMIN_TOKEN
docker compose up --build
# Dashboard: http://localhost:3000   Engine API: http://localhost:8000/docs
```

On first start the worker backfills about 18 months of results for every league
(`HISTORY_DAYS`), fits the ratings and writes predictions. That takes a few minutes. After that:

| Job | Default interval | What it does |
|---|---|---|
| Fixtures and results | 30 min | ESPN scoreboards for the last 3 days through the next 8 |
| Injuries | 2 h | ESPN injury reports (NBA, WNBA, NFL, MLB) |
| Odds | 2 h | The Odds API h2h prices, matched to fixtures by name and kick-off time |
| Predict | after each job | Grade results → recalibrate → re-predict. A new row is written only when an estimate changes |

## Running without Docker

```bash
# Engine (Python 3.11+, PostgreSQL 14+)
cd engine
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env               # set DATABASE_URL (and optional keys)
python -m predictx_engine.cli check-sources   # probe every data source
python -m predictx_engine.cli refresh         # one full fetch + predict
uvicorn predictx_engine.api:app --port 8000   # API
python -m predictx_engine.worker              # scheduler (separate terminal)
pytest                                        # 26 tests (SQLite by default)
TEST_DATABASE_URL=postgresql+psycopg://... pytest   # same tests against PostgreSQL

# Web (Node 20+)
cd web
cp .env.example .env.local         # ENGINE_URL=http://localhost:8000
npm install && npm run dev         # http://localhost:3000
```

## API credentials and costs

| Provider | Used for | Key? | Cost |
|---|---|---|---|
| **ESPN site API** (`site.api.espn.com`) | Fixtures, results, history, injuries, all 7 sports | No | Free, but public and **undocumented**. It can change without notice. Run `cli check-sources` after deploying. |
| **The Odds API** (`the-odds-api.com`) | Market-implied probabilities | `ODDS_API_KEY` | Free tier: 500 credits/month, enough for a few leagues at the default 2-hour interval. Paid plans start around **US$30/month (20k credits)**. Each `odds` call costs 1 credit per region, and the default `uk,eu` uses 2. Check current pricing on their site. |

Without `ODDS_API_KEY` the dashboard still works on the statistical models alone. It says so on
screen, and confidence scores are lower.

**Paid alternatives**, if you outgrow ESPN's unofficial feed: Sportradar (official data for every
sport here; enterprise pricing), API-Sports (api-football, api-basketball, api-rugby and others;
from about US$19/month per sport), football-data.org (free tier for top European football),
SportsDataIO (US sports). Each one would be a new module in `engine/predictx_engine/sources/`
that returns the same `ParsedEvent` objects.

Secrets are read only from environment variables. They are never stored in the database, logged,
or returned by the API, and the browser never sees the engine's address or any key.

## How probabilities are calculated

Each sport has its own model (`engine/predictx_engine/models/`):

| Sport | Model |
|---|---|
| Football | Time-weighted **Poisson goals model** (attack and defence strength per team, league-specific home and away scoring rates, 240-day half-life, Bayesian shrinkage for teams with few games) with a **Dixon-Coles** low-score correction. Gives home/draw/away probabilities. |
| Rugby union | **Elo** with margin-of-victory multiplier, home advantage and off-season regression. Draw probability comes from the observed draw rate (Beta prior), scaled down as the rating gap grows. |
| Tennis | Player **Elo** with experience-dependent K-factor (FiveThirtyEight method). Neutral venue. Singles only. |
| Basketball | **Elo** with NBA margin-of-victory multiplier, home court advantage, back-to-back penalty and off-season regression. |
| American football | **Elo** with home advantage, bye-week rest bonus, margin-of-victory multiplier and off-season regression. |
| Baseball | **Elo** (low K, 162-game season) with home advantage. |
| Cricket | **Elo** with home advantage. Test matches get a draw probability from the observed Test draw rate. |

Then, for every fixture:

1. **Market blend.** If bookmaker prices exist, the model and the de-margined market consensus are
   combined with a logarithmic opinion pool. The market weight starts at 0.5 and is refitted per
   sport from graded results. The model always contributes, so a bookmaker favourite is not
   assumed to win.
2. **Calibration.** Temperature scaling is fitted per sport on graded predictions once at least
   150 exist. Over-confident estimates get softened, under-confident ones sharpened.
3. **Insufficient Data.** If either side has fewer than 5 matches in history *and* there are no
   market prices, no number is shown. If only the market is available, the market probability is
   shown and labelled as such.
4. **Confidence** (0–100, High/Medium/Low) is separate from win probability. It measures how
   reliable the estimate is: match history depth, market availability and number of bookmakers,
   the model's Brier skill score (live, or walk-forward backtest until 50 live results exist), and
   injury-report availability where injuries matter.

Form (last 5), head-to-head, rest days and injury counts appear in each card's "How was this
calculated?" panel. Ratings already absorb results, so form and head-to-head are not added a
second time. Injury and lineup news enters through market prices; there is no hand-tuned injury
adjustment, because one would need per-player value data.

## Accuracy tracking

- Every estimate is stored in `predictions`, insert-only. A PostgreSQL trigger rejects `UPDATE`
  and `DELETE`, so history can't be rewritten after results are known.
- After an event finishes, the **last prediction created before kick-off** is graded in
  `graded_predictions`: outcome, correct or not, Brier score, log loss, and the model-only and
  market-only Brier scores for comparison.
- The **Accuracy** page shows per-sport live results, a calibration table (do 70% picks win about
  70% of the time?), recent graded predictions and each model's walk-forward backtest. The
  backtest is labelled separately from live performance.

## Freshness rules

- Each card shows when the estimate last changed and when its data was last checked.
- If a league's fixture feed hasn't refreshed successfully within `STALE_AFTER_HOURS` (default 6),
  its events are removed from the rankings and listed under "Outdated data", with the error.
- If the engine is unreachable, the dashboard shows an error rather than a cached list.

## Adding a sport or competition

- **Competition:** add a `League(...)` to `engine/predictx_engine/leagues.py` with the ESPN path
  and The Odds API key or group.
- **Sport:** add a `Sport(...)` there, add parameters to `models/elo.py` or a new `SportModel`
  subclass, and register it in `models/registry.py`.

## Known limitations

- ESPN's endpoints and league ids (especially rugby's numeric ids and the cricket header feed)
  are undocumented. If `check-sources` shows a league with zero events, update its path in
  `leagues.py`.
- Cricket history builds up from when the app starts running, because the feed only lists
  current series. Expect "Insufficient Data" or market-only cricket estimates at first.
- Starting pitchers (MLB), quarterbacks (NFL) and tennis surface are not modelled separately.
  Market prices are the channel for that information.
