"use client";

import { useState } from "react";
import type { Item } from "@/lib/types";
import { ago, kickoff, pct } from "@/lib/format";
import ProbabilityBar from "./ProbabilityBar";
import ConfidenceBadge from "./ConfidenceBadge";

export default function PredictionCard({ item, rank }: { item: Item; rank: number }) {
  const [open, setOpen] = useState(false);
  const { event: e, prediction: p } = item;
  if (!p || !p.probs || p.win_prob == null) return null;
  const isDraw = p.predicted === "draw";

  return (
    <article className="card p-4 sm:p-5">
      <div className="flex items-start gap-4">
        <div className="hidden sm:grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink-800 text-sm font-semibold text-slate-400 tnum">
          {rank}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
            <span className="rounded bg-ink-800 px-1.5 py-0.5 text-slate-300">{e.sport_name}</span>
            <span className="truncate">{e.competition}</span>
            <span>·</span>
            <time dateTime={e.start_time}>{kickoff(e.start_time)}</time>
          </div>
          <h3 className="mt-1.5 break-words text-lg font-semibold uppercase tracking-tight text-white sm:text-xl">
            {e.home} <span className="font-normal normal-case text-slate-500">vs</span> {e.away}
          </h3>
          <p className="mt-1 text-sm text-slate-400">
            {isDraw ? "Most likely outcome" : "Predicted winner"}:{" "}
            <span className="font-semibold uppercase text-win">{p.predicted_name}</span>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-3xl font-bold leading-none text-win tnum sm:text-4xl">{pct(p.win_prob)}</div>
          <div className="mt-1 text-[11px] uppercase tracking-wide text-slate-500">
            {isDraw ? "draw probability" : "win probability"}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <ProbabilityBar probs={p.probs} event={e} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <ConfidenceBadge label={p.confidence_label} score={p.confidence} />
        <span>Estimate updated {ago(p.updated_at)}</span>
        <span>· data checked {ago(item.freshness.data_checked_at)}</span>
        <button onClick={() => setOpen((v) => !v)} className="ml-auto text-slate-400 underline-offset-2 hover:underline">
          {open ? "Hide details" : "How was this calculated?"}
        </button>
      </div>

      {open && <Details item={item} />}
    </article>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-ink-800 py-1.5 last:border-0">
      <span className="text-slate-500">{k}</span>
      <span className="text-right text-slate-200 tnum">{v}</span>
    </div>
  );
}

function Details({ item }: { item: Item }) {
  const { event: e, prediction: p } = item;
  if (!p) return null;
  const f = p.factors ?? {};
  const m = f.model ?? {};
  const basis: Record<string, string> = {
    "model+market": "Statistical model blended with bookmaker consensus",
    model: "Statistical model only (no current market prices)",
    market: "Bookmaker consensus only (too little match history for the model)",
  };
  const fmt3 = (x?: { home: number; draw?: number; away: number } | null) =>
    x ? [pct(x.home), x.draw != null ? pct(x.draw) : null, pct(x.away)].filter(Boolean).join(" / ") : "—";

  return (
    <div className="mt-4 grid gap-4 rounded-xl bg-ink-850 p-4 text-sm sm:grid-cols-2">
      <div>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Probability sources</h4>
        <Row k="Basis" v={basis[f.basis] ?? f.basis} />
        <Row k={`Model (${e.draw_possible ? "H / D / A" : "A / B"})`} v={fmt3(p.model_probs)} />
        <Row k="Market (margin removed)" v={p.market_probs ? `${fmt3(p.market_probs)} · ${f.market?.bookmakers} books` : "—"} />
        <Row k="Final (calibrated)" v={fmt3(p.probs)} />
        <Row k="Model" v={p.model_version} />
        {"elo_diff" in m && <Row k="Rating gap (Elo, incl. home/rest)" v={m.elo_diff} />}
        {"expected_goals_home" in m && <Row k="Expected goals" v={`${m.expected_goals_home} – ${m.expected_goals_away}`} />}
      </div>
      <div>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Context</h4>
        <Row k="Recent form (last 5)" v={`${f.form_last5?.home || "—"} · ${f.form_last5?.away || "—"}`} />
        <Row k="Head-to-head (last 5)"
             v={f.head_to_head_last5?.meetings
               ? `${f.head_to_head_last5.home_side_wins}–${f.head_to_head_last5.draws}–${f.head_to_head_last5.away_side_wins}`
               : "no meetings on record"} />
        <Row k="Rest days" v={`${f.rest_days?.home ?? "—"} · ${f.rest_days?.away ?? "—"}`} />
        <Row k="Matches in history" v={`${f.games_in_history?.home ?? 0} · ${f.games_in_history?.away ?? 0}`} />
        {f.injuries_reported && <Row k="Players listed out/doubtful" v={`${f.injuries_reported.home ?? 0} · ${f.injuries_reported.away ?? 0}`} />}
        {e.neutral && <Row k="Venue" v="Neutral (no home advantage)" />}
      </div>
      {p.missing?.length > 0 && (
        <div className="sm:col-span-2">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-400/80">Missing or limited data</h4>
          <ul className="list-disc space-y-0.5 pl-5 text-slate-400">
            {p.missing.map((x) => <li key={x}>{x}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
