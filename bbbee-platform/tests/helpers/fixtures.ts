import type { EngineInput, RuleConfig } from "@/lib/engine";

/**
 * TEST FIXTURES — NOT REGULATORY VALUES.
 * Numbers here exercise engine mechanics only. They are deliberately round
 * and must never be copied into a production rule set.
 */
export const TEST_VERSION = "test-version-NOT-REGULATORY";

export function rule(partial: Partial<RuleConfig> & Pick<RuleConfig, "indicatorCode" | "formulaType" | "parameters">): RuleConfig {
  return {
    ruleId: `rule-${partial.indicatorCode}`,
    regulatoryVersionId: TEST_VERSION,
    element: "TEST_ELEMENT",
    weighting: "10",
    cap: null,
    bonusRule: null,
    roundingMethod: "NONE",
    configurationStatus: "CONFIGURED",
    provisionIds: ["prov-test"],
    ...partial,
  };
}

export function input(key: string, verifiedValue: string | null, extra: Partial<EngineInput> = {}): EngineInput {
  return { key, unit: "ZAR", verifiedValue, confidence: "HIGH", evidenceIds: [`ev-${key}`], ...extra };
}
