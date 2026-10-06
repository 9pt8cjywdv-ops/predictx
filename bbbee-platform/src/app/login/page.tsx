import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <main className="flex min-h-screen">
      <div className="hidden w-1/2 flex-col justify-between bg-brand-900 p-12 text-slate-200 lg:flex">
        <div className="text-sm font-semibold tracking-wide text-white">B-BBEE VERIFY</div>
        <div>
          <h1 className="text-3xl font-semibold leading-tight text-white">Verification management for B-BBEE agencies.</h1>
          <p className="mt-4 max-w-md text-sm text-slate-300">
            Evidence ingestion, regulatory traceability, deterministic scorecard calculation and independent technical review — with every score traceable to source.
          </p>
        </div>
        <p className="text-xs text-slate-400">AI-assisted results are provisional and require Verification Manager review and Technical Signatory sign-off.</p>
      </div>
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <h2 className="mb-6 text-lg font-semibold">Sign in</h2>
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
