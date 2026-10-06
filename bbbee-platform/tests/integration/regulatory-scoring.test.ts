/**
 * End-to-end: regulatory configuration → evidence → calculation → lineage.
 * Rule parameters here are ENGINE TEST FIXTURES, not regulatory values.
 */
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { traceCalculationResult } from "@/lib/lineage";
import { ForbiddenError } from "@/lib/rbac";
import { confirmEngagementRegulatoryVersion, RegulatoryWorkflowError, transitionRegulatoryVersion } from "@/lib/regulatory/service";
import { runProvisionalScorecard, ScoringPreconditionError } from "@/lib/scoring";
import { makeEngagement, makeOrg, makeUser } from "./factory";

async function makeFramework(label: string) {
  return prisma.regulatoryFramework.create({ data: { code: `FW-${label}-${Date.now()}`, name: `Framework ${label}` } });
}

describe("regulatory workflow", () => {
  it("drafts cannot be published; approval requires authority; windows cannot overlap", async () => {
    const org = await makeOrg();
    const analyst = await makeUser(org.id, "VERIFICATION_ANALYST");
    const admin = await makeUser(org.id, "ADMINISTRATOR");
    const signatory = await makeUser(org.id, "TECHNICAL_SIGNATORY");
    const fw = await makeFramework("wf");
    const v1 = await prisma.regulatoryVersion.create({ data: { frameworkId: fw.id, label: "v1", validFrom: new Date("2020-01-01") } });

    await expect(transitionRegulatoryVersion(admin, v1.id, "PUBLISHED")).rejects.toBeInstanceOf(RegulatoryWorkflowError);
    await expect(transitionRegulatoryVersion(analyst, v1.id, "UNDER_REVIEW")).rejects.toBeInstanceOf(ForbiddenError);
    await transitionRegulatoryVersion(admin, v1.id, "UNDER_REVIEW");
    await expect(transitionRegulatoryVersion(analyst, v1.id, "APPROVED")).rejects.toBeInstanceOf(ForbiddenError);
    await transitionRegulatoryVersion(signatory, v1.id, "APPROVED", "Reviewed against source");
    const published = await transitionRegulatoryVersion(signatory, v1.id, "PUBLISHED");
    expect(published.status).toBe("PUBLISHED");

    const v2 = await prisma.regulatoryVersion.create({ data: { frameworkId: fw.id, label: "v2", validFrom: new Date("2024-01-01"), status: "APPROVED", approvedById: signatory.id } });
    await expect(transitionRegulatoryVersion(signatory, v2.id, "PUBLISHED")).rejects.toThrow(/overlaps/);
    expect(await prisma.auditEvent.count({ where: { entityId: v1.id } })).toBe(3);
  });

  it("approval with unconfigured rules requires explicit acknowledgement", async () => {
    const org = await makeOrg();
    const signatory = await makeUser(org.id, "TECHNICAL_SIGNATORY");
    const fw = await makeFramework("ack");
    const v = await prisma.regulatoryVersion.create({ data: { frameworkId: fw.id, label: "v", status: "UNDER_REVIEW", validFrom: new Date("2020-01-01") } });
    const t = await prisma.scorecardTemplate.create({ data: { regulatoryVersionId: v.id, code: "T", name: "T", entityClassification: "QSE" } });
    const el = await prisma.scorecardElement.create({ data: { templateId: t.id, element: "OWNERSHIP", name: "O", sortOrder: 0 } });
    const ind = await prisma.scorecardIndicator.create({ data: { elementId: el.id, code: "O1", name: "O1", sortOrder: 0 } });
    await prisma.calculationRule.create({ data: { regulatoryVersionId: v.id, indicatorId: ind.id, indicatorCode: "O1", formulaType: "PROPORTIONAL", parameters: {} } });
    await expect(transitionRegulatoryVersion(signatory, v.id, "APPROVED")).rejects.toThrow(/REGULATORY_CONFIGURATION_REQUIRED/);
  });

  it("an engagement can only be bound to a version in force for its measurement period", async () => {
    const org = await makeOrg();
    const manager = await makeUser(org.id, "VERIFICATION_MANAGER");
    const { engagement } = await makeEngagement(org.id); // period ends 2026-02-28
    const fw = await makeFramework("bind");
    const future = await prisma.regulatoryVersion.create({ data: { frameworkId: fw.id, label: "future", status: "PUBLISHED", validFrom: new Date("2027-01-01") } });
    await expect(confirmEngagementRegulatoryVersion(manager, engagement.id, future.id, "basis")).rejects.toThrow(/not in force/);
    const current = await prisma.regulatoryVersion.create({ data: { frameworkId: fw.id, label: "current", status: "PUBLISHED", validFrom: new Date("2020-01-01"), validTo: new Date("2027-01-01") } });
    await expect(confirmEngagementRegulatoryVersion(manager, engagement.id, current.id, "AFS confirms generic activities")).resolves.toMatchObject({ regulatoryVersionId: current.id });
  });
});

describe("provisional scorecard with full lineage", () => {
  async function setup(configured: boolean) {
    const org = await makeOrg();
    const manager = await makeUser(org.id, "VERIFICATION_MANAGER");
    const { engagement } = await makeEngagement(org.id);
    const fw = await makeFramework("score");
    const version = await prisma.regulatoryVersion.create({ data: { frameworkId: fw.id, label: "TEST FIXTURE", status: "PUBLISHED", validFrom: new Date("2020-01-01") } });
    const regDoc = await prisma.regulatoryDocument.create({ data: { title: "Fixture Code", source: "test", documentType: "CODES_OF_GOOD_PRACTICE", version: "1", status: "PUBLISHED", gazetteNumber: "TEST-0000" } });
    const provision = await prisma.regulatoryProvision.create({ data: { documentId: regDoc.id, reference: "FX-1", text: "Fixture provision text for tests.", status: "PUBLISHED" } });
    const template = await prisma.scorecardTemplate.create({ data: { regulatoryVersionId: version.id, code: "FX", name: "Fixture", entityClassification: "QSE" } });
    const el = await prisma.scorecardElement.create({ data: { templateId: template.id, element: "SKILLS_DEVELOPMENT", name: "Skills", sortOrder: 0 } });
    const ind = await prisma.scorecardIndicator.create({ data: { elementId: el.id, code: "SD.SPEND", name: "Spend", sortOrder: 0 } });
    await prisma.calculationRule.create({
      data: {
        regulatoryVersionId: version.id,
        indicatorId: ind.id,
        indicatorCode: "SD.SPEND",
        formulaType: "PROPORTIONAL",
        parameters: { numeratorKey: "sd.spend", denominatorKey: "sd.leviable", target: "0.05" },
        weighting: "20",
        roundingMethod: "HALF_UP_2DP",
        configurationStatus: configured ? "CONFIGURED" : "REGULATORY_CONFIGURATION_REQUIRED",
        provisions: { create: { provisionId: provision.id } },
      },
    });
    await prisma.recognitionTable.create({
      data: { regulatoryVersionId: version.id, configurationStatus: "CONFIGURED", bands: { bands: [{ level: "FX1", minPoints: "15", recognitionPercent: "1" }], nonCompliantLabel: "Non-Compliant", nonCompliantRecognition: "0" } },
    });
    await prisma.verificationEngagement.update({ where: { id: engagement.id }, data: { regulatoryVersionId: version.id, regulatoryConfirmedAt: new Date(), scorecardTemplateId: template.id, entityClassification: "QSE" } });

    const doc = await prisma.document.create({ data: { engagementId: engagement.id, title: "Training invoices.xlsx", documentClass: "TRAINING_INVOICE" } });
    const dv = await prisma.documentVersion.create({
      data: { documentId: doc.id, versionNumber: 1, originalFilename: "Training invoices.xlsx", mimeType: "x", sizeBytes: 1, sha256: "c".repeat(64), storageKey: "k", uploadedById: manager.id },
    });
    const mk = async (inputKey: string, verified: string, claimed: string, row: number, confirmed: boolean) => {
      const ci = await prisma.calculationInput.create({ data: { engagementId: engagement.id, indicatorCode: "SD.SPEND", inputKey, unit: "ZAR", clientClaim: claimed, verifiedValue: verified, confidence: "HIGH" } });
      const ev = await prisma.evidenceItem.create({
        data: {
          engagementId: engagement.id, documentVersionId: dv.id, dataKey: inputKey, label: inputKey, sourceLocation: { sheet: "Summary", row, column: "D" },
          originalValue: `R${verified}`, normalisedValue: verified, unit: "ZAR", extractionMethod: "SPREADSHEET_PARSE", confidence: "HIGH",
          reviewStatus: confirmed ? "CONFIRMED" : "UNREVIEWED", confirmedById: confirmed ? manager.id : null, confirmedAt: confirmed ? new Date() : null,
        },
      });
      await prisma.evidenceLink.create({ data: { evidenceItemId: ev.id, targetType: "CALCULATION_INPUT", targetId: ci.id } });
    };
    return { manager, engagement, mk, provision, version };
  }

  it("calculates from verified values only and traces score → evidence → document and score → provision → version", async () => {
    const { manager, engagement, mk, provision, version } = await setup(true);
    await mk("sd.spend", "410000", "600000", 12, true);
    await mk("sd.leviable", "10000000", "10000000", 3, true);

    const { output, scorecardId } = await runProvisionalScorecard(manager, engagement.id);
    // 0.041 / 0.05 = 0.82 × 20 = 16.4 — from the verified R410,000, not the claimed R600,000.
    expect(output.indicators[0]).toMatchObject({ status: "CALCULATED", points: "16.4" });
    expect(output.discount?.after.level).toBe("FX1");

    const result = await prisma.calculationResult.findFirstOrThrow({ where: { scorecardId } });
    const lineage = await traceCalculationResult(result.id, engagement.id);
    expect(lineage.auditable).toBe(true);
    expect(lineage.breaks).toEqual([]);
    const spend = lineage.evidenceChain.find((c) => c.inputKey === "sd.spend")!;
    expect(spend.evidence[0]).toMatchObject({ originalValue: "R410000", sourceLocation: { sheet: "Summary", row: 12, column: "D" }, document: { filename: "Training invoices.xlsx" } });
    expect(lineage.regulatoryChain.provisions[0]).toMatchObject({ id: provision.id, reference: "FX-1", gazetteNumber: "TEST-0000" });
    expect(lineage.regulatoryChain.regulatoryVersion.id).toBe(version.id);

    expect(await prisma.auditEvent.count({ where: { engagementId: engagement.id, eventType: { in: ["CALCULATION_RUN", "SCORE_CHANGED"] } } })).toBe(2);
  });

  it("reports broken lineage when evidence has not been confirmed by a reviewer", async () => {
    const { manager, engagement, mk } = await setup(true);
    await mk("sd.spend", "410000", "600000", 12, false);
    await mk("sd.leviable", "10000000", "10000000", 3, true);
    const { scorecardId } = await runProvisionalScorecard(manager, engagement.id);
    const result = await prisma.calculationResult.findFirstOrThrow({ where: { scorecardId } });
    const lineage = await traceCalculationResult(result.id, engagement.id);
    expect(lineage.auditable).toBe(false);
    expect(lineage.breaks.join(" ")).toMatch(/not been confirmed/);
  });

  it("unconfigured rules block scoring and are persisted as such", async () => {
    const { manager, engagement, mk } = await setup(false);
    await mk("sd.spend", "410000", "600000", 12, true);
    await mk("sd.leviable", "10000000", "10000000", 3, true);
    const { output, scorecardId } = await runProvisionalScorecard(manager, engagement.id);
    expect(output.complete).toBe(false);
    expect(output.discount).toBeNull();
    const summary = await prisma.scorecardResult.findUniqueOrThrow({ where: { scorecardId } });
    expect(summary.totalPoints).toBeNull();
    expect(summary.levelAfterDiscount).toBeNull();
  });

  it("refuses to score without a confirmed regulatory version", async () => {
    const org = await makeOrg();
    const manager = await makeUser(org.id, "VERIFICATION_MANAGER");
    const { engagement } = await makeEngagement(org.id);
    await expect(runProvisionalScorecard(manager, engagement.id)).rejects.toBeInstanceOf(ScoringPreconditionError);
  });

  it("technical signatories cannot run calculations (independence)", async () => {
    const { engagement, manager } = await setup(true);
    const signatory = await makeUser(manager.organisationId, "TECHNICAL_SIGNATORY");
    await expect(runProvisionalScorecard(signatory, engagement.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
