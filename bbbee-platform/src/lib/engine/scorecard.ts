import { calculateIndicator } from "./calculate";
import { isLowConfidence } from "./confidence";
import { D, dec } from "./decimal";
import { applyDiscount, testPriorityElement, type DiscountPolicy, type DiscountResult, type PriorityElementResult, type PriorityRuleConfig } from "./priority";
import { levelForPoints, type RecognitionTableConfig } from "./recognition";
import type { EngineInput, IndicatorResult, RuleConfig } from "./types";

export const PROVISIONAL_LABEL = "PROVISIONAL VERIFIED SCORE — AI-ASSISTED VERIFICATION RESULT — VERIFICATION MANAGER REVIEW REQUIRED — TECHNICAL SIGN-OFF REQUIRED";

export interface ScorecardConfig {
  regulatoryVersionId: string;
  entityClassification: string;
  rules: RuleConfig[];
  priorityRules: PriorityRuleConfig[];
  recognitionTable: RecognitionTableConfig;
  discountPolicy: DiscountPolicy | null;
}

export interface ElementSummary {
  element: string;
  points: string | null;
  bonusPoints: string | null;
  complete: boolean;
}

export interface ScorecardOutput {
  label: string;
  regulatoryVersionId: string;
  indicators: IndicatorResult[];
  elements: ElementSummary[];
  totalPoints: string | null;
  complete: boolean;
  priority: PriorityElementResult[];
  discount: DiscountResult | null;
  lowConfidenceAreas: Array<{ indicatorCode: string; confidence: string; points: string | null }>;
  blockers: string[];
}

/**
 * Full deterministic scorecard. If any indicator is not CALCULATED the total is
 * still shown for transparency but `complete` is false and no level is claimed.
 */
export function calculateScorecard(config: ScorecardConfig, inputs: EngineInput[]): ScorecardOutput {
  const versions = new Set(config.rules.map((r) => r.regulatoryVersionId));
  if (versions.size > 1 || (versions.size === 1 && !versions.has(config.regulatoryVersionId))) {
    throw new Error("All rules must belong to the scorecard's regulatory version — mixing Code versions is not permitted.");
  }
  const indicators = config.rules.map((r) => calculateIndicator(r, inputs));
  const blockers: string[] = [];

  const elementOrder = [...new Set(config.rules.map((r) => r.element))];
  const elements: ElementSummary[] = elementOrder.map((element) => {
    const rs = indicators.filter((i) => i.element === element);
    const complete = rs.every((r) => r.status === "CALCULATED");
    const sum = (f: "points" | "bonusPoints") => rs.reduce((a, r) => a.plus(dec(r[f] ?? "0")), new D(0)).toFixed();
    return { element, points: sum("points"), bonusPoints: sum("bonusPoints"), complete };
  });

  for (const i of indicators) if (i.status !== "CALCULATED") blockers.push(`${i.indicatorCode}: ${i.status}`);
  const complete = blockers.length === 0;
  const total = indicators.reduce((a, r) => a.plus(dec(r.points ?? "0")).plus(dec(r.bonusPoints ?? "0")), new D(0));

  const priority = config.priorityRules.map((p) =>
    testPriorityElement(p, config.entityClassification, indicators.filter((i) => i.element === p.element)),
  );

  let discount: DiscountResult | null = null;
  if (complete) {
    const before = levelForPoints(config.recognitionTable, total);
    discount = applyDiscount(before, priority, config.discountPolicy, config.recognitionTable);
    if (discount.status === "REGULATORY_CONFIGURATION_REQUIRED") blockers.push("Recognition/discount: REGULATORY_CONFIGURATION_REQUIRED");
  }

  return {
    label: PROVISIONAL_LABEL,
    regulatoryVersionId: config.regulatoryVersionId,
    indicators,
    elements,
    totalPoints: total.toFixed(),
    complete,
    priority,
    discount,
    lowConfidenceAreas: indicators
      .filter((i) => i.status === "CALCULATED" && isLowConfidence(i.confidence))
      .map((i) => ({ indicatorCode: i.indicatorCode, confidence: i.confidence, points: i.points })),
    blockers,
  };
}
