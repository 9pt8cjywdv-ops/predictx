export const pct = (p: number | null | undefined, digits = 0) =>
  p == null ? "—" : `${(p * 100).toFixed(digits)}%`;

export function kickoff(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} ${time}`;
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export type Window = "today" | "tomorrow" | "7d";

export function windowRange(w: Window): { start: string; end: string } {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (w === "today") {
    const end = startOfDay(now);
    end.setDate(end.getDate() + 1);
    return { start: now.toISOString(), end: end.toISOString() };
  }
  if (w === "tomorrow") {
    const s = startOfDay(now);
    s.setDate(s.getDate() + 1);
    const e = new Date(s);
    e.setDate(e.getDate() + 1);
    return { start: s.toISOString(), end: e.toISOString() };
  }
  const e = new Date(now.getTime() + 7 * 86400_000);
  return { start: now.toISOString(), end: e.toISOString() };
}
