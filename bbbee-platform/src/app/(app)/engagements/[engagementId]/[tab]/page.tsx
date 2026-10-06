import { notFound } from "next/navigation";
import { Card, Notice } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { ENGAGEMENT_TABS } from "../tabs";

const DESCRIPTIONS: Record<string, string> = {
  entity: "Measured-entity profile, revenue streams and turnover evidence extracted by the DOCUMENT_EVIDENCE_AGENT.",
  ownership: "Multi-tier ownership tracing, voting rights, economic interest and net value inputs prepared by the OWNERSHIP_AGENT.",
  "management-control": "Board and management demographics reconciled across payroll, employee listings and EEA reports.",
  "skills-development": "Leviable amount, eligible training expenditure and learner evidence chains.",
  procurement: "Supplier master, certificate/affidavit validity and recognised spend.",
  "supplier-development": "Supplier Development beneficiaries, eligibility and recognised contributions.",
  "enterprise-development": "Enterprise Development beneficiaries, eligibility and recognised contributions.",
  sed: "SED beneficiaries, qualifying beneficiary fractions and recognised contributions.",
  "sector-elements": "Sector-specific scorecard elements from installed Sector Codes.",
  queries: "Verification query register, client responses and evidence requests.",
  risks: "POTENTIAL VERIFICATION RISK register from the professional scepticism engine.",
  "technical-review": "Independent technical review against a locked snapshot, with sign-off gate.",
  reports: "Provisional verification report, query sheet, calculation workbook and audit trail exports.",
};

export default async function PhaseTab({ params }: { params: Promise<{ engagementId: string; tab: string }> }) {
  const user = await requireUser();
  const { tab } = await params;
  const def = ENGAGEMENT_TABS.find((t) => t.slug === tab);
  if (!def || (user.role === "CLIENT_USER" && !def.clientVisible)) notFound();
  return (
    <Card title={def.label}>
      <p className="mb-4 text-sm text-slate-600">{DESCRIPTIONS[tab]}</p>
      <Notice tone="blue" title={`Delivered in build phase ${def.phase}`}>
        The data model for this area is already in place; its agent, workflow and screens are scheduled for phase {def.phase}.
      </Notice>
    </Card>
  );
}
