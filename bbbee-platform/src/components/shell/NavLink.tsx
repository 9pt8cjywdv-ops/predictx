"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, children, exact = false }: { href: string; children: React.ReactNode; exact?: boolean }) {
  const path = usePathname();
  const active = exact ? path === href : path === href || path.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={clsx(
        "block rounded-md px-3 py-1.5 text-sm transition",
        active ? "bg-white/10 font-medium text-white" : "text-slate-300 hover:bg-white/5 hover:text-white",
      )}
    >
      {children}
    </Link>
  );
}

export function TabLink({ href, children }: { href: string; children: React.ReactNode }) {
  const path = usePathname();
  const active = path === href;
  return (
    <Link
      href={href}
      className={clsx(
        "whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium uppercase tracking-wide transition",
        active ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700",
      )}
    >
      {children}
    </Link>
  );
}
