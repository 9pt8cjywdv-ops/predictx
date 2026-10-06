import { describe, expect, it } from "vitest";
import {
  applyDiscount,
  bandAt,
  calculateIndicator,
  calculateScorecard,
  levelForPoints,
  testPriorityElement,
  validateRecognitionTable,
  type DiscountPolicy,
  type PriorityRuleConfig,
  type RecognitionTableConfig,
} from "@/lib/engine";
import { input, rule, TEST_VERSION } from "../helpers/fixtures";

const table: RecognitionTableConfig = {
  regulatoryVersionId: TEST_VERSION,
  configurationStatus: "CONFIGURED",
  bands: [
    { level: "A", minPoints: "90", recognitionPercent: "1.5" },
    { level: "B", minPoints: "70", recognitionPercent: "1" },
    { level: "C", minPoints: "50", recognitionPercent: "0.5" },
  ],
  nonCompliantLabel: "Non-Compliant",
  nonCompliantRecognition: "0",
};
const policy: DiscountPolicy = { configurationStatus: "CONFIGURED", mode: "ONE_LEVEL_IF_ANY_FAIL", levelsPerDiscount: 1 };

describe("recognition table", () => {
  it("maps points to levels at inclusive lower bounds", () => {
    expect(levelForPoints(table, "90").level).toBe("A");
    expect(levelForPoints(table, "89.9999").level).toBe("B");
    expect(levelForPoints(table, "50").level).toBe("C");
    expect(levelForPoints(table, "49.99")).toMatchObject({ level: "Non-Compliant", recognitionPercent: "0" });
  });
  it("refuses to determine a level when not configured", () => {
    expect(levelForPoints({ ...table, configurationStatus: "REGULATORY_CONFIGURATION_REQUIRED" }, "100").status).toBe("REGULATORY_CONFIGURATION_REQUIRED");
  });
  it("rejects mis-ordered bands", () => {
    expect(validateRecognitionTable({ ...table, bands: [table.bands[1]!, table.bands[0]!] })).not.toHaveLength(0);
    expect(() => levelForPoints({ ...table, bands: [table.bands[1]!, table.bands[0]!] }, "95")).toThrow();
  });
  it("bandAt clamps to non-compliant", () => {
    expect(bandAt(table, 99).level).toBe("Non-Compliant");
  });
});

const priorityRule: PriorityRuleConfig = {
  element: "E1",
  configurationStatus: "CONFIGURED",
  applicableTo: ["GENERIC", "QSE"],
  groups: [{ label: "E1 total", indicatorCodes: ["I1", "I2"], availablePoints: "20", fraction: "0.4" }],
  includeBonus: false,
};

function res(code: string, points: string, bonus = "0") {
  const r = calculateIndicator(rule({ indicatorCode: code, element: "E1", formulaType: "BANDED", parameters: { inputKey: "x", bands: [{ min: "0", points }] }, weighting: "100" }), [input("x", "1")]);
  return { ...r, bonusPoints: bonus };
}

describe("priority element testing", () => {
  it("passes at exactly the sub-minimum", () => {
    const p = testPriorityElement(priorityRule, "GENERIC", [res("I1", "5"), res("I2", "3")]);
    expect(p.outcome).toBe("PASS");
    expect(p.groups[0]).toMatchObject({ required: "8", achieved: "8", percentAchieved: "0.4" });
  });
  it("fails below the sub-minimum and requires a discount", () => {
    const p = testPriorityElement(priorityRule, "GENERIC", [res("I1", "5"), res("I2", "2.99")]);
    expect(p).toMatchObject({ outcome: "FAIL", discountRequired: true });
  });
  it("excludes bonus unless configured to include it", () => {
    expect(testPriorityElement(priorityRule, "GENERIC", [res("I1", "5", "5"), res("I2", "0")]).outcome).toBe("FAIL");
    expect(testPriorityElement({ ...priorityRule, includeBonus: true }, "GENERIC", [res("I1", "5", "5"), res("I2", "0")]).outcome).toBe("PASS");
  });
  it("is NOT_APPLICABLE for classifications outside scope", () => {
    expect(testPriorityElement(priorityRule, "EME", []).outcome).toBe("NOT_APPLICABLE");
  });
  it("reports INSUFFICIENT_INPUTS rather than passing or failing", () => {
    const blocked = { ...res("I2", "0"), status: "INSUFFICIENT_INPUTS" as const, points: null };
    expect(testPriorityElement(priorityRule, "GENERIC", [res("I1", "20"), blocked]).outcome).toBe("INSUFFICIENT_INPUTS");
  });
});

describe("discounting", () => {
  const fail = { element: "E1", outcome: "FAIL" as const, groups: [], discountRequired: true };
  const fail2 = { ...fail, element: "E2" };
  const pass = { element: "E3", outcome: "PASS" as const, groups: [], discountRequired: false };

  it("discounts one level when any priority element fails", () => {
    const d = applyDiscount(levelForPoints(table, "92"), [fail, fail2, pass], policy, table);
    expect(d).toMatchObject({ status: "APPLIED", levelsDiscounted: 1 });
    expect(d.after.level).toBe("B");
  });
  it("supports a per-failed-element policy", () => {
    const d = applyDiscount(levelForPoints(table, "92"), [fail, fail2], { ...policy, mode: "PER_FAILED_ELEMENT" }, table);
    expect(d.after.level).toBe("C");
  });
  it("discounting below the lowest band yields non-compliant", () => {
    const d = applyDiscount(levelForPoints(table, "55"), [fail], policy, table);
    expect(d.after.level).toBe("Non-Compliant");
  });
  it("does not discount when all priority elements pass", () => {
    expect(applyDiscount(levelForPoints(table, "92"), [pass], policy, table).status).toBe("NOT_REQUIRED");
  });
  it("refuses to apply an unconfigured discount policy", () => {
    expect(applyDiscount(levelForPoints(table, "92"), [fail], { ...policy, configurationStatus: "REGULATORY_CONFIGURATION_REQUIRED" }, table).status).toBe("REGULATORY_CONFIGURATION_REQUIRED");
  });
});

describe("calculateScorecard", () => {
  const rules = [
    rule({ indicatorCode: "I1", element: "E1", formulaType: "PROPORTIONAL", parameters: { numeratorKey: "a", target: "100" }, weighting: "60" }),
    rule({ indicatorCode: "I2", element: "E2", formulaType: "PROPORTIONAL", parameters: { numeratorKey: "b", target: "100" }, weighting: "40" }),
  ];
  const cfg = { regulatoryVersionId: TEST_VERSION, entityClassification: "GENERIC", rules, priorityRules: [], recognitionTable: table, discountPolicy: policy };

  it("totals element points and determines a level", () => {
    const out = calculateScorecard(cfg, [input("a", "100"), input("b", "75")]);
    expect(out.totalPoints).toBe("90");
    expect(out.complete).toBe(true);
    expect(out.discount?.after.level).toBe("A");
    expect(out.label).toContain("PROVISIONAL VERIFIED SCORE");
  });

  it("does not claim a level when any indicator is blocked", () => {
    const out = calculateScorecard(cfg, [input("a", "100")]);
    expect(out.complete).toBe(false);
    expect(out.discount).toBeNull();
    expect(out.blockers).toContain("I2: INSUFFICIENT_INPUTS");
  });

  it("flags material areas resting on low-confidence evidence", () => {
    const out = calculateScorecard(cfg, [input("a", "100"), input("b", "75", { confidence: "LOW" })]);
    expect(out.lowConfidenceAreas).toEqual([{ indicatorCode: "I2", confidence: "LOW", points: "30" }]);
  });

  it("refuses to mix rules from different regulatory versions", () => {
    expect(() => calculateScorecard({ ...cfg, rules: [...rules, { ...rules[0]!, regulatoryVersionId: "other" }] }, [])).toThrow(/mixing Code versions/);
  });
});
