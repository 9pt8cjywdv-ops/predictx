import Link from "next/link";
import { notFound } from "next/navigation";
import { TabLink } from "@/components/shell/NavLink";
import { Badge, PageHeader, StatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { NotFoundError } from "@/lib/rbac";
import { getScopedEngagement } from "@/lib/tenancy";
import { ENGAGEMENT_TABS } from "./tabs";

export default async function EngagementLayout({ children, params }: { children: React.ReactNode; params: Promise<{ engagementId: string }> }) {
  const user = await requireUser();
  const { engagementId } = await params;
  let e;
  try {
    e = await getScopedEngagement(user, engagementId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const period = e.measurementPeriods.find((p) => p.isPrimary) ?? e.measurementPeriods[0];
  const tabs = ENGAGEMENT_TABS.filter((t) => user.role !== "CLIENT_USER" || t.clientVisible);
  const base = `/engagements/${e.id}`;

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/engagements" className="hover:underline">Engagements</Link>}
        title={`${e.reference} · ${e.measuredEntity.legalName}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={e.status} />
            <span className="num">{period ? `${period.label}: ${formatDate(period.startDate)} → ${formatDate(period.endDate)}` : "No measurement period"}</span>
            <span>·</span>
            {e.regulatoryVersion ? <span>{e.regulatoryVersion.framework.name} — {e.regulatoryVersion.label}</span> : <Badge tone="amber">Code version not confirmed</Badge>}
          </span>
        }
      />
      <nav className="-mt-4 mb-6 flex overflow-x-auto border-b border-slate-200">
        {tabs.map((t) => (
          <TabLink key={t.slug} href={t.slug ? `${base}/${t.slug}` : base}>{t.label}</TabLink>
        ))}
      </nav>
      {children}
    </>
  );
}
