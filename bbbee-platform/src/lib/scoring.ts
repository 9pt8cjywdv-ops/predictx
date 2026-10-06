import type { Prisma } from "@prisma/client";
import { AuditEventType, recordAudit } from "./audit";
import { prisma } from "./db";
import {
  calculateScorecard,
  ENGINE_VERSION,
  REGULATORY_CONFIGURATION_REQUIRED,
  type DiscountPolicy,
  type EngineInput,
  type PriorityRuleConfig,
  type RecognitionBand,
  type RecognitionTableConfig,
  type RuleConfig,
  type ScorecardOutput,
} from "./engine";
import { Permission, requirePermission, type Principal } from "./rbac";
import { getScopedEngagement } from "./tenancy";

export class ScoringPreconditionError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "ScoringPreconditionError";
  }
}

const dstr = (v: Prisma.Decimal | null | undefined) => (v == null ? null : v.toString());

/** Load the versioned scorecard configuration from the Regulatory Library into engine types. */
export async function loadScorecardConfig(templateId: string) {
  const template = await prisma.scorecardTemplate.findUniqueOrThrow({
    where: { id: templateId },
    include: {
      regulatoryVersion: { include: { recognitionTables: true } },
      elements: { orderBy: { sortOrder: "asc" }, include: { indicators: { orderBy: { sortOrder: "asc" } } } },
    },
  });
  const versionId = template.regulatoryVersionId;
  const indicatorIds = template.elements.flatMap((e) => e.indicators.map((i) => i.id));
  const dbRules = await prisma.calculationRule.findMany({
    where: { regulatoryVersionId: versionId, indicatorId: { in: indicatorIds } },
    include: { provisions: true, indicator: { include: { scorecardElement: true } } },
  });
  const ruleByIndicator = new Map(dbRules.map((r) => [r.indicatorId, r]));

  const rules: RuleConfig[] = template.elements.flatMap((el) =>
    el.indicators.map((ind) => {
      const r = ruleByIndicator.get(ind.id);
      if (!r) {
        // An indicator without a rule is reported, never silently scored.
        return {
          ruleId: `missing:${ind.id}`,
          regulatoryVersionId: versionId,
          indicatorCode: ind.code,
          element: el.element,
          formulaType: "PROPORTIONAL",
          parameters: {},
          weighting: null,
          cap: null,
          bonusRule: null,
          roundingMethod: "NONE",
          configurationStatus: REGULATORY_CONFIGURATION_REQUIRED,
          provisionIds: [],
        } satisfies RuleConfig;
      }
      return {
        ruleId: r.id,
        regulatoryVersionId: r.regulatoryVersionId,
        indicatorCode: r.indicatorCode,
        element: el.element,
        formulaType: r.formulaType,
        parameters: r.parameters as RuleConfig["parameters"],
        weighting: dstr(r.weighting),
        cap: dstr(r.cap),
        bonusRule: (r.bonusRule as RuleConfig["bonusRule"]) ?? null,
        roundingMethod: r.roundingMethod,
        configurationStatus: r.configurationStatus,
        provisionIds: r.provisions.map((p) => p.provisionId),
      } satisfies RuleConfig;
    }),
  );

  const priorityRules: PriorityRuleConfig[] = template.elements
    .filter((e) => e.isPriorityElement)
    .map((e) => {
      const cfg = (e.priorityRule ?? {}) as Partial<PriorityRuleConfig>;
      return {
        element: e.element,
        configurationStatus: e.configurationStatus,
        applicableTo: cfg.applicableTo ?? [],
        groups: cfg.groups ?? [],
        includeBonus: cfg.includeBonus ?? false,
      };
    });

  const rt = template.regulatoryVersion.recognitionTables[0];
  const rtBands = (rt?.bands ?? {}) as { bands?: RecognitionBand[]; nonCompliantLabel?: string; nonCompliantRecognition?: string };
  const recognitionTable: RecognitionTableConfig = {
    regulatoryVersionId: versionId,
    configurationStatus: rt?.configurationStatus ?? REGULATORY_CONFIGURATION_REQUIRED,
    bands: rtBands.bands ?? [],
    nonCompliantLabel: rtBands.nonCompliantLabel ?? "Non-Compliant",
    nonCompliantRecognition: rtBands.nonCompliantRecognition ?? "0",
  };
  const discountPolicy = (rt?.discountPolicy as DiscountPolicy | null) ?? null;

  return { template, rules, priorityRules, recognitionTable, discountPolicy };
}

export async function loadEngineInputs(engagementId: string): Promise<EngineInput[]> {
  const inputs = await prisma.calculationInput.findMany({ where: { engagementId } });
  const links = await prisma.evidenceLink.findMany({
    where: { targetType: "CALCULATION_INPUT", targetId: { in: inputs.map((i) => i.id) }, relation: { in: ["SUPPORTS", "PARTIALLY_SUPPORTS"] } },
  });
  return inputs.map((i) => ({
    key: i.inputKey,
    unit: i.unit as EngineInput["unit"],
    verifiedValue: dstr(i.verifiedValue),
    clientClaim: dstr(i.clientClaim),
    confidence: i.confidence,
    calculationInputId: i.id,
    evidenceIds: links.filter((l) => l.targetId === i.id).map((l) => l.evidenceItemId),
  }));
}

/**
 * Run the deterministic engine for an engagement and persist a provisional
 * scorecard with full traces. Never labelled as a certificate.
 */
export async function runProvisionalScorecard(user: Principal, engagementId: string): Promise<{ scorecardId: string; output: ScorecardOutput }> {
  await requirePermission(user, Permission.CALCULATION_RUN);
  const engagement = await getScopedEngagement(user, engagementId);
  if (!engagement.regulatoryVersionId) throw new ScoringPreconditionError("Applicable regulatory version has not been confirmed.");
  if (!engagement.scorecardTemplateId) throw new ScoringPreconditionError("Scorecard template has not been selected.");

  const cfg = await loadScorecardConfig(engagement.scorecardTemplateId);
  if (cfg.template.regulatoryVersionId !== engagement.regulatoryVersionId) {
    throw new ScoringPreconditionError("Scorecard template belongs to a different regulatory version than the engagement.");
  }
  const inputs = await loadEngineInputs(engagementId);
  const output = calculateScorecard(
    {
      regulatoryVersionId: engagement.regulatoryVersionId,
      entityClassification: engagement.entityClassification,
      rules: cfg.rules,
      priorityRules: cfg.priorityRules,
      recognitionTable: cfg.recognitionTable,
      discountPolicy: cfg.discountPolicy,
    },
    inputs,
  );

  const previous = await prisma.scorecard.findFirst({
    where: { engagementId, isScenario: false },
    orderBy: { createdAt: "desc" },
    include: { summary: true },
  });

  const scorecardId = await prisma.$transaction(async (tx) => {
    const sc = await tx.scorecard.create({
      data: { engagementId, templateId: cfg.template.id, kind: previous ? "REASSESSMENT" : "INITIAL_ASSESSMENT" },
    });
    for (const ind of output.indicators) {
      if (ind.trace.ruleId.startsWith("missing:")) continue;
      await tx.calculationResult.create({
        data: {
          engagementId,
          scorecardId: sc.id,
          calculationRuleId: ind.trace.ruleId,
          indicatorCode: ind.indicatorCode,
          status: ind.status,
          trace: ind.trace as unknown as Prisma.InputJsonValue,
          points: ind.points,
          bonusPoints: ind.bonusPoints,
          confidence: ind.confidence,
          engineVersion: ENGINE_VERSION,
        },
      });
    }
    const level = output.discount;
    await tx.scorecardResult.create({
      data: {
        scorecardId: sc.id,
        totalPoints: output.complete ? output.totalPoints : null,
        levelBeforeDiscount: level?.before.level ?? null,
        levelAfterDiscount: level?.after.level ?? null,
        recognitionPercent: level?.after.recognitionPercent ?? null,
        priorityResults: output.priority as unknown as Prisma.InputJsonValue,
        resultLabel: output.label,
        lowConfidenceAreas: output.lowConfidenceAreas as unknown as Prisma.InputJsonValue,
      },
    });
    await recordAudit(tx, {
      eventType: AuditEventType.CALCULATION_RUN,
      organisationId: user.organisationId,
      engagementId,
      userId: user.id,
      entityType: "Scorecard",
      entityId: sc.id,
      newValue: { engineVersion: ENGINE_VERSION, complete: output.complete, blockers: output.blockers.slice(0, 50) },
    });
    const prevTotal = previous?.summary?.totalPoints?.toString() ?? null;
    const newTotal = output.complete ? output.totalPoints : null;
    if (prevTotal !== newTotal || previous?.summary?.levelAfterDiscount !== (level?.after.level ?? null)) {
      await recordAudit(tx, {
        eventType: AuditEventType.SCORE_CHANGED,
        organisationId: user.organisationId,
        engagementId,
        userId: user.id,
        entityType: "Scorecard",
        entityId: sc.id,
        previousValue: { totalPoints: prevTotal, level: previous?.summary?.levelAfterDiscount ?? null },
        newValue: { totalPoints: newTotal, level: level?.after.level ?? null },
      });
    }
    return sc.id;
  });
  return { scorecardId, output };
}
