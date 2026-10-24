import type { EventInfo, Probs } from "@/lib/types";
import { pct } from "@/lib/format";

export default function ProbabilityBar({ probs, event, compact = false }: { probs: Probs; event: EventInfo; compact?: boolean }) {
  const segs = [
    { key: "home", label: event.home, p: probs.home, cls: "bg-win" },
    ...(probs.draw != null ? [{ key: "draw", label: "Draw", p: probs.draw, cls: "bg-draw" }] : []),
    { key: "away", label: event.away, p: probs.away, cls: "bg-lose" },
  ];
  return (
    <div>
      <div className={`flex w-full overflow-hidden rounded-full bg-ink-700 ${compact ? "h-1.5" : "h-2.5"}`}
           role="img" aria-label={segs.map((s) => `${s.label} ${pct(s.p)}`).join(", ")}>
        {segs.map((s) => (
          <div key={s.key} className={`${s.cls} h-full`} style={{ width: `${s.p * 100}%` }} />
        ))}
      </div>
      {!compact && (
        <div className="mt-1.5 flex flex-col gap-0.5 text-xs text-slate-400 tnum sm:flex-row sm:justify-between sm:gap-2">
          {segs.map((s) => (
            <span key={s.key} className="min-w-0 sm:truncate">
              <span className={`mr-1 inline-block h-2 w-2 rounded-full ${s.cls}`} />
              {s.label} <span className="text-slate-200">{pct(s.p)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
