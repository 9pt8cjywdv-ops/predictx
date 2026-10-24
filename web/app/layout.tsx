import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "PredictX Sports — Winner Probabilities",
  description: "Calibrated win probabilities for upcoming sporting events.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">
        <header className="border-b border-ink-800 bg-ink-950/80 backdrop-blur sticky top-0 z-20">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-win/15 text-win">◈</span>
              PredictX <span className="text-slate-500 font-normal">Sports</span>
            </Link>
            <nav className="flex gap-1 text-sm">
              <Link href="/" className="rounded-lg px-3 py-1.5 text-slate-300 hover:bg-ink-800">Predictions</Link>
              <Link href="/accuracy" className="rounded-lg px-3 py-1.5 text-slate-300 hover:bg-ink-800">Accuracy</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 pb-10 pt-4 text-xs text-slate-500">
          Probabilities are statistical estimates, never guarantees. Win probability = estimated chance of that
          outcome. Confidence = how reliable the estimate is, based on data coverage and track record. No betting
          features are offered.
        </footer>
      </body>
    </html>
  );
}
