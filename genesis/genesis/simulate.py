"""Simulation runner.

  python -m genesis.simulate --verify
      Run the automated scenario suite (tests A-H and invariants) and record the
      result in the configured database. Live mode requires a passing record.

  python -m genesis.simulate --days 365 --seeds 1,2,3,4,5 --report docs/SIMULATION_RESULTS.md
      Run independent virtual ecosystems (fresh database each) and write a report.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from sqlalchemy import func, select

from .brain import HeuristicBrain
from .config import load_settings
from .ledger import A, Ledger
from .models import Agent, Distribution
from .money import to_usd, usd
from .policy import set_state
from .reporting import overview
from .runtime import build_runtime
from .treasury import reconcile

SIM_WALLET = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359"


def verify() -> int:
    root = Path(__file__).resolve().parent.parent
    t0 = time.time()
    proc = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", str(root / "tests")],
                          capture_output=True, text=True, cwd=root)
    tail = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else proc.stderr[-500:]
    passed = int(m.group(1)) if (m := re.search(r"(\d+) passed", tail)) else 0
    failed = int(m.group(1)) if (m := re.search(r"(\d+) failed", tail)) else 0
    errors = int(m.group(1)) if (m := re.search(r"(\d+) error", tail)) else 0
    total = passed + failed + errors
    ok = proc.returncode == 0 and total > 0 and failed == 0 and errors == 0
    rt = build_runtime(create_schema=True)
    with rt.core.tx() as s:
        set_state(s, "last_simulation_verification", {
            "ts": rt.core.now().isoformat(), "wall_clock": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "passed": passed, "total": total, "all_passed": ok, "summary": tail,
            "output_sha256": hashlib.sha256(proc.stdout.encode()).hexdigest(), "seconds": round(time.time() - t0, 1),
        }, rt.core.now())
    print(proc.stdout[-3000:])
    print(("PASS" if ok else "FAIL") + f": {passed}/{total} - recorded in database")
    return 0 if ok else 1


def run_ecosystem(seed: int, days: int, workdir: Path, strategy: str | None = None, market: str | None = None) -> dict:
    db = workdir / f"sim-{seed}.db"
    settings = load_settings(database_url=f"sqlite:///{db}", admin_token="sim", sim_seed=seed, master_key="sim")
    rt = build_runtime(settings, brain=HeuristicBrain(seed))
    core = rt.core
    import random

    rng = random.Random(seed)
    strategy = strategy or rng.choice(["research_reports", "micro_saas", "spot_momentum"])
    core.run(lambda s: core.contribute_capital(s, usd(50), actor="sim"))
    agent = core.run(lambda s: core.create_genesis_agent(s, actor="sim", strategy_key=strategy, market=market))
    with core.tx() as s:
        set_state(s, "admin_wallet", {"address": SIM_WALLET, "network": "base"}, core.now())
        market = core.get_agent(s, agent.id).strategy_profile["market"]
    t0 = time.time()
    peak_active = 0
    for _ in range(days):
        rt.orchestrator.advance(24)
        with core.tx() as s:
            peak_active = max(peak_active, s.scalar(select(func.count(Agent.id)).where(Agent.status == "active")))
    with core.tx() as s:
        ov = overview(core, s)
        rec = reconcile(s, core.signer(s), core.treasury_address(s))
        l = Ledger(s)
        dists = list(s.scalars(select(Distribution)))
        agents = list(s.scalars(select(Agent).order_by(Agent.seq)))
        strategies = {}
        for a in agents:
            strategies[a.strategy_key] = strategies.get(a.strategy_key, 0) + 1
        result = {
            "seed": seed, "days": days, "genesis_strategy": strategy, "genesis_market": market,
            "agents_created": len(agents), "alive": sum(a.status == "active" for a in agents),
            "deceased": sum(a.status == "deceased" for a in agents), "peak_active": peak_active,
            "max_generation": max(a.generation for a in agents),
            "revenue": ov["total_revenue"], "trading_pnl": ov["trading_pnl_realized"], "expenses": ov["total_expenses"],
            "realized_profit": ov["realized_net_profit"], "distributed_to_owner": ov["total_distributions"],
            "net_assets": ov["net_assets"],
            "owner_total_return": round((ov["total_distributions"] + ov["net_assets"] - 50) / 50, 3),
            "weeks": len(dists), "weeks_paid": sum(d.status == "executed" for d in dists),
            "births": ov["births"], "reconciled": rec["ok"], "balanced": l.is_balanced(),
            "final_strategies": strategies, "seconds": round(time.time() - t0, 1),
        }
    rt.engine.dispose()
    return result


def write_report(results: list[dict], path: Path, days: int, verification: str | None) -> None:
    n = len(results)
    lines = [
        "# Simulation results",
        "",
        "Generated by `python -m genesis.simulate`. **All figures are virtual USDC produced by an assumption-driven",
        "simulation model** (see `genesis/simworld.py`): zero-drift crypto prices, low and highly uneven niche demand",
        "with a cold start, realistic fees and model-usage costs. They demonstrate that the ecosystem's mechanics work;",
        "they are **not** a forecast of real-world revenue.",
        "",
        f"Each run: one genesis agent with $50, the deterministic heuristic brain (Claude usage metered at Haiku 5.5",
        f"rates), {days} simulated days, administrator wallet configured, default conservative policy.",
        "",
    ]
    if verification:
        lines += ["## Automated scenario verification", "", "```", verification.strip(), "```", ""]
    lines += [
        "## Per-run outcomes", "",
        "| Seed | Genesis strategy / market | Agents | Alive | Dead | Max gen | Revenue | Expenses | Realized profit | Paid to owner | Net assets | Owner return on $50 | Books |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in results:
        lines.append(
            f"| {r['seed']} | {r['genesis_strategy']} / {r['genesis_market']} | {r['agents_created']} | {r['alive']} | {r['deceased']} | "
            f"{r['max_generation']} | ${r['revenue']:,.2f} | ${r['expenses']:,.2f} | ${r['realized_profit']:,.2f} | "
            f"${r['distributed_to_owner']:,.2f} | ${r['net_assets']:,.2f} | {r['owner_total_return'] * 100:,.0f}% | "
            f"{'reconciled' if r['reconciled'] and r['balanced'] else 'MISMATCH'} |")
    prof = [r for r in results if r["realized_profit"] > 0]
    extinct = [r for r in results if r["alive"] == 0]
    repro = [r for r in results if r["births"] > 0]
    lines += [
        "",
        "## Summary", "",
        f"- Runs: {n}; ecosystems with positive realized profit: {len(prof)}; extinct ecosystems: {len(extinct)}; "
        f"ecosystems that reproduced at least once: {len(repro)}.",
        f"- Total paid to the owner across runs: ${sum(r['distributed_to_owner'] for r in results):,.2f} "
        f"against ${50 * n:,.2f} of virtual capital invested.",
        f"- Every run's ledger balanced and reconciled against the simulated chain: "
        f"{'yes' if all(r['reconciled'] and r['balanced'] for r in results) else 'NO - investigate'}.",
        "",
        "Interpretation: outcomes are dominated by whether the genesis agent lands in (or discovers) a viable niche.",
        "Unleveraged spot trading in a zero-drift market loses money to fees on average, by design. Most experiments",
        "fail; the ecosystem's job is to fail cheaply, keep the books exact and only pay out realized profit.",
        "",
        "Raw data:", "", "```json", json.dumps(results, indent=1), "```", "",
    ]
    path.write_text("\n".join(lines))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="genesis.simulate")
    ap.add_argument("--verify", action="store_true", help="run the scenario test suite and record the result")
    ap.add_argument("--days", type=int, default=180)
    ap.add_argument("--seeds", default="1,2,3")
    ap.add_argument("--strategy", default=None)
    ap.add_argument("--market", default=None)
    ap.add_argument("--append", action="store_true", help="append runs to an existing report's raw data")
    ap.add_argument("--report", default=None, help="write a markdown report here")
    ap.add_argument("--include-verification", default=None, help="file with pytest summary to embed")
    args = ap.parse_args(argv)
    if args.verify:
        return verify()
    seeds = [int(x) for x in args.seeds.split(",") if x.strip()]
    results = []
    with tempfile.TemporaryDirectory() as tmp:
        for seed in seeds:
            r = run_ecosystem(seed, args.days, Path(tmp), args.strategy, args.market)
            print(json.dumps({k: r[k] for k in ("seed", "genesis_strategy", "genesis_market", "agents_created", "alive",
                                                "deceased", "realized_profit", "distributed_to_owner", "net_assets",
                                                "reconciled", "seconds")}))
            results.append(r)
    if args.report and args.append and Path(args.report).exists():
        prior = Path(args.report).read_text().split("```json", 1)[1].split("```", 1)[0]
        results = json.loads(prior) + results
    if args.report:
        ver = Path(args.include_verification).read_text() if args.include_verification else None
        write_report(results, Path(args.report), args.days, ver)
        print("report written to", args.report)
    return 0 if all(r["reconciled"] and r["balanced"] for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
