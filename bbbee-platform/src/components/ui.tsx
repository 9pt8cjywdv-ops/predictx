import clsx from "clsx";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium uppercase tracking-wider text-slate-500">{eyebrow}</div>}
        <h1 className="truncate text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-slate-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={clsx("rounded-lg border border-slate-200 bg-white shadow-sm", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {actions}
        </header>
      )}
      <div className={clsx(padded && "p-4")}>{children}</div>
    </section>
  );
}

type ButtonProps = ComponentProps<"button"> & { variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "sm" | "md" };

const buttonStyles = (variant: ButtonProps["variant"] = "primary", size: ButtonProps["size"] = "md") =>
  clsx(
    "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50",
    size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm",
    variant === "primary" && "bg-brand-600 text-white shadow-sm hover:bg-brand-700",
    variant === "secondary" && "border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50",
    variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
    variant === "ghost" && "text-slate-600 hover:bg-slate-100",
  );

export function Button({ variant, size, className, ...props }: ButtonProps) {
  return <button className={clsx(buttonStyles(variant, size), className)} {...props} />;
}

export function LinkButton({ href, variant, size, children }: { href: string; variant?: ButtonProps["variant"]; size?: ButtonProps["size"]; children: ReactNode }) {
  return (
    <Link href={href} className={buttonStyles(variant, size)}>
      {children}
    </Link>
  );
}

const TONES = {
  gray: "bg-slate-100 text-slate-700 ring-slate-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "gray", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={clsx("inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", TONES[tone])}>
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  // engagement
  DRAFT: "gray", EVIDENCE_COLLECTION: "blue", ANALYSIS: "blue", AWAITING_CLIENT: "amber", VERIFICATION_MANAGER_REVIEW: "violet",
  TECHNICAL_REVIEW: "violet", RETURNED_FOR_CORRECTION: "red", APPROVED: "green", CLOSED: "gray",
  // documents
  RECEIVED: "gray", QUARANTINED: "amber", CLASSIFIED: "blue", EXTRACTED: "green", FAILED: "red", DUPLICATE: "amber",
  CLEAN: "green", INFECTED: "red", NOT_SCANNED: "amber", PENDING: "gray", REJECTED: "red",
  // confidence
  HIGH: "green", MEDIUM: "blue", LOW: "amber", UNVERIFIED: "gray",
  // regulatory
  UNDER_REVIEW: "amber", PUBLISHED: "green", SUPERSEDED: "gray", WITHDRAWN: "red",
  // calculation
  CALCULATED: "green", REGULATORY_CONFIGURATION_REQUIRED: "red", INSUFFICIENT_INPUTS: "amber", ERROR: "red", CONFIGURED: "green",
  PASS: "green", FAIL: "red", NOT_APPLICABLE: "gray",
  // evidence
  VERIFIED: "green", PARTIALLY_VERIFIED: "blue", INSUFFICIENT: "amber", INVALID: "red", OUTSIDE_PERIOD: "amber", CONFLICTING: "red", REVIEW_REQUIRED: "amber",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONES[status] ?? "gray"}>{status.replace(/_/g, " ")}</Badge>;
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={clsx("whitespace-nowrap bg-slate-50 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500", className)}>{children}</th>;
}

export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return <td colSpan={colSpan} className={clsx("px-3 py-2 align-top text-slate-700", className)}>{children}</td>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-slate-300 px-6 py-10 text-center">
      <div className="text-sm font-medium text-slate-700">{title}</div>
      {children && <div className="mt-1 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function Notice({ tone = "amber", title, children }: { tone?: "amber" | "red" | "blue" | "green"; title: string; children?: ReactNode }) {
  const styles = {
    amber: "border-amber-300 bg-amber-50 text-amber-900",
    red: "border-red-300 bg-red-50 text-red-900",
    blue: "border-blue-300 bg-blue-50 text-blue-900",
    green: "border-emerald-300 bg-emerald-50 text-emerald-900",
  }[tone];
  return (
    <div className={clsx("rounded-md border-l-4 px-4 py-3 text-sm", styles)}>
      <div className="font-semibold">{title}</div>
      {children && <div className="mt-0.5 opacity-90">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, href, hint }: { label: string; value: ReactNode; href?: string; hint?: string }) {
  const body = (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:border-slate-300">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="num mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function DL({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{k}</dt>
          <dd className="mt-0.5 text-sm text-slate-800">{v ?? <span className="text-slate-400">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ErrorBanner({ message }: { message?: string | string[] }) {
  const m = Array.isArray(message) ? message[0] : message;
  if (!m) return null;
  return <Notice tone="red" title="Action not completed">{m}</Notice>;
}
