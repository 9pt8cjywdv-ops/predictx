import { dec, D } from "./decimal";
import { bandAt, type LevelResult, type RecognitionTableConfig } from "./recognition";
import { CONFIGURED, type ConfigurationStatus, type IndicatorResult } from "./types";

export type PriorityOutcome = "PASS" | "FAIL" | "NOT_APPLICABLE" | "REGULATORY_CONFIGURATION_REQUIRED" | "INSUFFICIENT_INPUTS";

/** A group of indicators whose combined points must reach `fraction × available`. */
export interface SubminimumGroup {
  label: string;
  indicatorCodes: string[];
  /** Points available for the group (sum of indicator weightings, excl. bonus). */
  availablePoints: string;
  /** Required fraction, e.g. "0.4". */
  fraction: string;
}

export interface PriorityRuleConfig {
  element: string;
  configurationStatus: ConfigurationStatus | string;
  /** Entity classifications for which this element is a priority element. */
  applicableTo: string[];
  groups: SubminimumGroup[];
  /** Whether bonus points count towards the sub-minimum. */
  includeBonus: boolean;
}

export interface DiscountPolicy {
  configurationStatus: ConfigurationStatus | string;
  /** ONE_LEVEL_IF_ANY_FAIL: a single discount regardless of the number of failures. */
  mode: "ONE_LEVEL_IF_ANY_FAIL" | "PER_FAILED_ELEMENT";
  levelsPerDiscount: number;
}

export interface GroupOutcome {
  label: string;
  required: string | null;
  achieved: string | null;
  percentAchieved: string | null;
  outcome: PriorityOutcome;
}

export interface PriorityElementResult {
  element: string;
  outcome: PriorityOutcome;
  groups: GroupOutcome[];
  discountRequired: boolean;
}

export function testPriorityElement(
  rule: PriorityRuleConfig,
  entityClassification: string,
  results: IndicatorResult[],
): PriorityElementResult {
  if (!rule.applicableTo.includes(entityClassification)) {
    return { element: rule.element, outcome: "NOT_APPLICABLE", groups: [], discountRequired: false };
  }
  if (rule.configurationStatus !== CONFIGURED) {
    return { element: rule.element, outcome: "REGULATORY_CONFIGURATION_REQUIRED", groups: [], discountRequired: false };
  }
  const byCode = new Map(results.map((r) => [r.indicatorCode, r]));
  const groups: GroupOutcome[] = rule.groups.map((g) => {
    const rs = g.indicatorCodes.map((c) => byCode.get(c));
    const required = dec(g.availablePoints).times(dec(g.fraction));
    if (rs.some((r) => !r || r.status === "REGULATORY_CONFIGURATION_REQUIRED")) {
      return { label: g.label, required: required.toFixed(), achieved: null, percentAchieved: null, outcome: "REGULATORY_CONFIGURATION_REQUIRED" };
    }
    if (rs.some((r) => r!.status !== "CALCULATED")) {
      return { label: g.label, required: required.toFixed(), achieved: null, percentAchieved: null, outcome: "INSUFFICIENT_INPUTS" };
    }
    const achieved = rs.reduce(
      (acc, r) => acc.plus(dec(r!.points ?? "0")).plus(rule.includeBonus ? dec(r!.bonusPoints ?? "0") : 0),
      new D(0),
    );
    const available = dec(g.availablePoints);
    return {
      label: g.label,
      required: required.toFixed(),
      achieved: achieved.toFixed(),
      percentAchieved: available.isZero() ? null : achieved.dividedBy(available).toFixed(),
      outcome: achieved.greaterThanOrEqualTo(required) ? "PASS" : "FAIL",
    };
  });

  const outcomes = groups.map((g) => g.outcome);
  const outcome: PriorityOutcome = outcomes.includes("REGULATORY_CONFIGURATION_REQUIRED")
    ? "REGULATORY_CONFIGURATION_REQUIRED"
    : outcomes.includes("INSUFFICIENT_INPUTS")
      ? "INSUFFICIENT_INPUTS"
      : outcomes.includes("FAIL")
        ? "FAIL"
        : "PASS";
  return { element: rule.element, outcome, groups, discountRequired: outcome === "FAIL" };
}

export interface DiscountResult {
  status: "APPLIED" | "NOT_REQUIRED" | "REGULATORY_CONFIGURATION_REQUIRED" | "UNDETERMINED";
  levelsDiscounted: number;
  before: LevelResult;
  after: LevelResult;
  reasons: string[];
}

export function applyDiscount(
  before: LevelResult,
  priorityResults: PriorityElementResult[],
  policy: DiscountPolicy | null,
  table: RecognitionTableConfig,
): DiscountResult {
  const failed = priorityResults.filter((p) => p.outcome === "FAIL");
  const undetermined = priorityResults.filter(
    (p) => p.outcome === "REGULATORY_CONFIGURATION_REQUIRED" || p.outcome === "INSUFFICIENT_INPUTS",
  );
  if (before.status !== "DETERMINED" || before.bandIndex == null) {
    return { status: "REGULATORY_CONFIGURATION_REQUIRED", levelsDiscounted: 0, before, after: before, reasons: ["Level not determinable."] };
  }
  if (failed.length === 0) {
    if (undetermined.length > 0) {
      return {
        status: "UNDETERMINED",
        levelsDiscounted: 0,
        before,
        after: before,
        reasons: undetermined.map((p) => `${p.element}: priority test ${p.outcome}`),
      };
    }
    return { status: "NOT_REQUIRED", levelsDiscounted: 0, before, after: before, reasons: [] };
  }
  if (!policy || policy.configurationStatus !== CONFIGURED) {
    return {
      status: "REGULATORY_CONFIGURATION_REQUIRED",
      levelsDiscounted: 0,
      before,
      after: before,
      reasons: ["Priority element failed but discount policy is not configured."],
    };
  }
  const steps = policy.mode === "ONE_LEVEL_IF_ANY_FAIL" ? policy.levelsPerDiscount : policy.levelsPerDiscount * failed.length;
  const after = bandAt(table, before.bandIndex + steps);
  return {
    status: "APPLIED",
    levelsDiscounted: after.bandIndex! - before.bandIndex,
    before,
    after,
    reasons: failed.map((p) => `${p.element} failed sub-minimum`),
  };
}
