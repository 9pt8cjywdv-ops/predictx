"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Item, Meta, PredictionsResponse } from "@/lib/types";
import { ago, kickoff, pct, windowRange, type Window } from "@/lib/format";
import PredictionCard from "./PredictionCard";
import ProbabilityBar from "./ProbabilityBar";

const REFRESH_MS = 5 * 60_000;

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error || body?.detail || `Request failed (${r.status})`);
  return body as T;
}

export default function Dashboard() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [data, setData] = useState<PredictionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sport, setSport] = useState("");
  const [league, setLeague] = useState("");
  const [win, setWin] = useState<Window>("7d");
  const [minProb, setMinProb] = useState(50);

  useEffect(() => {
    getJSON<Meta>("/api/engine/meta").then(setMeta).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { start, end } = windowRange(win);
    const q = new URLSearchParams({ start, end, min_prob: String(minProb / 100), top: "10" });
    if (sport) q.set("sport", sport);
    if (league) q.set("league", league);
    try {
      setData(await getJSON<PredictionsResponse>(`/api/engine/predictions?${q}`));
      setError(null);
    } catch (e) {
      setData(null); // never keep showing an old result as if it were current
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sport, league, win, minProb]);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const leagues = useMemo(
    () => (meta?.leagues ?? []).filter((l) => !sport || l.sport === sport),
    [meta, sport],
  );
  const best = data?.top[0];

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Top predicted winners</h1>
        <p className="mt-1 text-sm text-slate-400">
          Upcoming events ranked by the estimated probability of the most likely outcome.
        </p>
        {best?.prediction && (
          <p className="mt-3 rounded-xl border border-win/30 bg-win/5 px-4 py-3 text-sm text-slate-300">
            Most likely winner right now:{" "}
            <span className="font-semibold text-white">{best.prediction.predicted_name}</span> ({best.event.home} vs{" "}
            {best.event.away}, {kickoff(best.event.start_time)}) at{" "}
            <span className="font-semibold text-win">{pct(best.prediction.win_prob)}</span>.
          </p>
        )}
      </section>

      <Filters
        meta={meta} sport={sport} league={league} win={win} minProb={minProb} leagues={leagues}
        onSport={(s) => { setSport(s); setLeague(""); }} onLeague={setLeague} onWin={setWin} onMinProb={setMinProb}
      />

      {meta && !meta.odds_configured && (
        <Notice tone="info">
          Market odds are not configured, so probabilities come from the statistical models alone and confidence is
          lower. Set <code className="text-slate-200">ODDS_API_KEY</code> on the engine to add bookmaker consensus.
        </Notice>
      )}

      {error && <Notice tone="error">{error}</Notice>}

      {loading && !data && !error && <Skeleton />}

      {data && (
        <>
          {data.top.length === 0 ? (
            <Notice tone="info">
              No current predictions match these filters. {data.insufficient.length > 0 &&
                `${data.insufficient.length} event(s) have insufficient data.`}{" "}
              {data.not_current.length > 0 && `${data.not_current.length} event(s) have outdated data and are hidden.`}
            </Notice>
          ) : (
            <section className="space-y-3">
              {data.top.map((it, i) => <PredictionCard key={it.event.id} item={it} rank={i + 1} />)}
            </section>
          )}

          {data.ranked.length > data.top.length && <AllEvents items={data.ranked.slice(data.top.length)} offset={data.top.length} />}
          {data.insufficient.length > 0 && <Insufficient items={data.insufficient} />}
          {data.not_current.length > 0 && <NotCurrent items={data.not_current} />}

          <p className="text-xs text-slate-500">
            Generated {ago(data.generated_at)} · auto-refreshes every 5 minutes {loading && "· refreshing…"}
          </p>
        </>
      )}
    </div>
  );
}

function Filters(props: {
  meta: Meta | null; sport: string; league: string; win: Window; minProb: number;
  leagues: Meta["leagues"]; onSport: (s: string) => void; onLeague: (l: string) => void;
  onWin: (w: Window) => void; onMinProb: (n: number) => void;
}) {
  const { meta, sport, league, win, minProb, leagues } = props;
  return (
    <section className="card space-y-4 p-4">
      <div className="flex flex-wrap gap-2">
        <button className={`chip ${sport === "" ? "chip-on" : "chip-off"}`} onClick={() => props.onSport("")}>All sports</button>
        {(meta?.sports ?? []).map((s) => (
          <button key={s.key} className={`chip ${sport === s.key ? "chip-on" : "chip-off"}`} onClick={() => props.onSport(s.key)}>
            {s.name}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex rounded-xl border border-ink-700 p-0.5 text-sm">
          {([["today", "Today"], ["tomorrow", "Tomorrow"], ["7d", "Next 7 days"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => props.onWin(k)}
                    className={`rounded-lg px-3 py-1.5 ${win === k ? "bg-ink-700 text-white" : "text-slate-400 hover:text-slate-200"}`}>
              {l}
            </button>
          ))}
        </div>
        <select value={league} onChange={(e) => props.onLeague(e.target.value)}
                className="rounded-xl border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-slate-200"
                aria-label="League or competition">
          <option value="">All competitions</option>
          {leagues.map((l) => (
            <option key={l.key} value={l.key}>{l.name}{l.upcoming ? ` (${l.upcoming})` : ""}</option>
          ))}
        </select>
        <label className="flex flex-1 items-center gap-3 text-sm text-slate-400 min-w-[220px]">
          Min. win probability
          <input type="range" min={50} max={95} step={5} value={minProb}
                 onChange={(e) => props.onMinProb(Number(e.target.value))} className="flex-1 accent-emerald-400" />
          <span className="w-10 text-right font-semibold text-slate-200 tnum">{minProb}%</span>
        </label>
      </div>
    </section>
  );
}

function AllEvents({ items, offset }: { items: Item[]; offset: number }) {
  return (
    <section className="card overflow-hidden">
      <h2 className="border-b border-ink-800 px-4 py-3 text-sm font-semibold text-slate-300">More upcoming events</h2>
      <ul className="divide-y divide-ink-800">
        {items.map((it, i) => (
          <li key={it.event.id} className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 px-4 py-3 sm:grid-cols-[2rem_1fr_12rem_auto]">
            <span className="text-xs text-slate-500 tnum">{offset + i + 1}</span>
            <div className="min-w-0">
              <div className="truncate text-sm text-white">{it.event.home} vs {it.event.away}</div>
              <div className="truncate text-xs text-slate-500">
                {it.event.sport_name} · {it.event.competition} · {kickoff(it.event.start_time)}
              </div>
            </div>
            <div className="hidden sm:block">
              {it.prediction?.probs && <ProbabilityBar probs={it.prediction.probs} event={it.event} compact />}
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold text-win tnum">{pct(it.prediction?.win_prob)}</div>
              <div className="max-w-[9rem] truncate text-xs text-slate-400">{it.prediction?.predicted_name}</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Insufficient({ items }: { items: Item[] }) {
  return (
    <details className="card p-4">
      <summary className="cursor-pointer text-sm font-semibold text-slate-300">
        Insufficient Data ({items.length}) — no probability shown
      </summary>
      <ul className="mt-3 space-y-2 text-sm">
        {items.map((it) => (
          <li key={it.event.id} className="flex flex-wrap justify-between gap-2">
            <span className="text-slate-200">{it.event.home} vs {it.event.away}
              <span className="text-slate-500"> · {it.event.competition} · {kickoff(it.event.start_time)}</span></span>
            <span className="text-xs text-slate-500">{it.prediction?.missing.find((m) => m.startsWith("Limited")) ?? "Insufficient Data"}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function NotCurrent({ items }: { items: Item[] }) {
  return (
    <details className="card border-amber-500/30 p-4">
      <summary className="cursor-pointer text-sm font-semibold text-amber-300">
        Outdated data ({items.length}) — hidden from rankings
      </summary>
      <ul className="mt-3 space-y-2 text-sm">
        {items.map((it) => (
          <li key={it.event.id} className="flex flex-wrap justify-between gap-2">
            <span className="text-slate-300">{it.event.home} vs {it.event.away}
              <span className="text-slate-500"> · {kickoff(it.event.start_time)}</span></span>
            <span className="text-xs text-amber-300/80">{it.freshness.reason}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Notice({ tone, children }: { tone: "info" | "error"; children: React.ReactNode }) {
  const cls = tone === "error" ? "border-rose-500/40 bg-rose-500/5 text-rose-200" : "border-ink-700 bg-ink-900 text-slate-400";
  return <div className={`rounded-xl border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

function Skeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading predictions">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="card h-36 animate-pulse bg-ink-900" />
      ))}
    </div>
  );
}
