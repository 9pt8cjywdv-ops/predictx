"use client";

import { useEffect, useState } from "react";
import { kickoff, pct } from "@/lib/format";

type Summary = {
  n: number; accuracy: number; brier: number; log_loss: number;
  model_only_brier: number | null; market_only_brier: number | null;
  calibration: { range: string; n: number; mean_predicted: number; observed: number }[];
};
type Backtest = { run_at: string; model_version: string; history_games: number;
  backtest: { n: number; brier: number; log_loss: number; accuracy: number } | null };
type Accuracy = {
  overall: Summary | null;
  sports: { sport: string; name: string; live: Summary | null; backtest: Backtest | null }[];
  recent: { event_id: string; sport: string; start_time: string; match: string; predicted: string;
    win_prob: number; outcome: string; correct: boolean; brier: number }[];
  notes: string[];
};

const f3 = (x: number | null | undefined) => (x == null ? "—" : x.toFixed(3));

export default function AccuracyPage() {
  const [data, setData] = useState<Accuracy | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/engine/accuracy", { cache: "no-store" })
      .then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b.error || "Failed to load"); return b; })
      .then(setData).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Prediction accuracy</h1>
        <p className="mt-1 text-sm text-slate-400">
          Every prediction is stored before the event starts and graded after the result. Stored predictions cannot be edited.
        </p>
      </div>
      {error && <div className="rounded-xl border border-rose-500/40 px-4 py-3 text-sm text-rose-200">{error}</div>}
      {!data && !error && <div className="card h-40 animate-pulse" />}
      {data && (
        <>
          {data.overall && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Graded predictions" value={String(data.overall.n)} />
              <Stat label="Predicted outcome correct" value={pct(data.overall.accuracy, 1)} />
              <Stat label="Brier score (lower is better)" value={f3(data.overall.brier)} />
              <Stat label="Log loss" value={f3(data.overall.log_loss)} />
            </div>
          )}
          <section className="card overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr className="border-b border-ink-800">
                  <th className="px-4 py-3">Sport</th>
                  <th className="px-3 py-3">Live graded</th>
                  <th className="px-3 py-3">Correct</th>
                  <th className="px-3 py-3">Brier</th>
                  <th className="px-3 py-3">Model-only Brier</th>
                  <th className="px-3 py-3">Market-only Brier</th>
                  <th className="px-3 py-3">Backtest (n · correct · Brier)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800 tnum">
                {data.sports.map((s) => (
                  <tr key={s.sport}>
                    <td className="px-4 py-3 text-slate-200">{s.name}</td>
                    <td className="px-3 py-3">{s.live?.n ?? 0}</td>
                    <td className="px-3 py-3">{s.live ? pct(s.live.accuracy, 1) : "—"}</td>
                    <td className="px-3 py-3">{f3(s.live?.brier)}</td>
                    <td className="px-3 py-3">{f3(s.live?.model_only_brier)}</td>
                    <td className="px-3 py-3">{f3(s.live?.market_only_brier)}</td>
                    <td className="px-3 py-3 text-slate-400">
                      {s.backtest?.backtest
                        ? `${s.backtest.backtest.n} · ${pct(s.backtest.backtest.accuracy, 1)} · ${f3(s.backtest.backtest.brier)}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {data.overall && data.overall.calibration.length > 0 && (
            <section className="card p-4">
              <h2 className="text-sm font-semibold text-slate-300">Calibration — do 70% predictions win ~70% of the time?</h2>
              <div className="mt-4 space-y-2">
                {data.overall.calibration.map((b) => (
                  <div key={b.range} className="grid grid-cols-[5rem_1fr_7rem] items-center gap-3 text-xs">
                    <span className="text-slate-400">{b.range}</span>
                    <div className="relative h-3 rounded bg-ink-800">
                      <div className="absolute inset-y-0 left-0 rounded bg-win/70" style={{ width: `${b.observed * 100}%` }} />
                      <div className="absolute inset-y-[-3px] w-0.5 bg-white" style={{ left: `${b.mean_predicted * 100}%` }}
                           title="mean predicted" />
                    </div>
                    <span className="text-slate-400 tnum">{pct(b.observed)} won · n={b.n}</span>
                  </div>
                ))}
                <p className="pt-1 text-xs text-slate-500">Bar = observed win rate; white tick = average predicted probability.</p>
              </div>
            </section>
          )}

          {data.recent.length > 0 && (
            <section className="card overflow-hidden">
              <h2 className="border-b border-ink-800 px-4 py-3 text-sm font-semibold text-slate-300">Recently graded</h2>
              <ul className="divide-y divide-ink-800 text-sm">
                {data.recent.map((r) => (
                  <li key={r.event_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                    <span className="text-slate-200">{r.match} <span className="text-xs text-slate-500">· {kickoff(r.start_time)}</span></span>
                    <span className="text-xs text-slate-400 tnum">
                      predicted {r.predicted} {pct(r.win_prob)} · result {r.outcome}{" "}
                      <span className={r.correct ? "text-win" : "text-rose-300"}>{r.correct ? "✓" : "✗"}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!data.overall && (
            <p className="text-sm text-slate-400">
              No predictions have been graded yet. Results appear here once events with stored pre-match predictions finish.
            </p>
          )}
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-500">
            {data.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="text-2xl font-bold text-white tnum">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{label}</div>
    </div>
  );
}
