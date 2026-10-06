import { logoutAction } from "@/app/login/actions";
import { NavLink } from "@/components/shell/NavLink";
import { requireUser } from "@/lib/auth/session";
import { humanize } from "@/lib/format";
import { can, Permission } from "@/lib/rbac";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const isClient = user.role === "CLIENT_USER";
  const [canRegulatory, canAudit, canClients] = await Promise.all([
    can(user, Permission.REGULATORY_VIEW),
    can(user, Permission.AUDIT_VIEW),
    can(user, Permission.CLIENT_VIEW),
  ]);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col bg-brand-900 px-3 py-4">
        <div className="mb-6 px-3 text-xs font-semibold tracking-[0.2em] text-white">B-BBEE VERIFY</div>
        <nav className="space-y-0.5">
          <NavLink href="/" exact>{isClient ? "My verifications" : "Dashboard"}</NavLink>
          {canClients && <NavLink href="/clients">Clients</NavLink>}
          <NavLink href="/engagements">Engagements</NavLink>
          {canRegulatory && <NavLink href="/regulatory">Regulatory library</NavLink>}
          {canAudit && <NavLink href="/audit">Audit log</NavLink>}
        </nav>
        <div className="mt-auto border-t border-white/10 px-3 pt-3 text-xs text-slate-400">
          <div className="truncate font-medium text-slate-200">{user.name}</div>
          <div className="truncate">{humanize(user.role)}</div>
          <form action={logoutAction}>
            <button className="mt-2 text-slate-300 hover:text-white">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-8 py-6">{children}</main>
    </div>
  );
}
