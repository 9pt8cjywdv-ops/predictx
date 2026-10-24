const STYLES = {
  High: "border-emerald-500/40 text-emerald-300",
  Medium: "border-amber-500/40 text-amber-300",
  Low: "border-rose-500/40 text-rose-300",
} as const;

export default function ConfidenceBadge({ label, score }: { label: keyof typeof STYLES; score: number }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${STYLES[label]}`}
          title="Model confidence: reliability of this estimate (data coverage, market prices, track record). Not a win probability.">
      Confidence: {label} <span className="text-slate-500 tnum">{Math.round(score)}/100</span>
    </span>
  );
}
