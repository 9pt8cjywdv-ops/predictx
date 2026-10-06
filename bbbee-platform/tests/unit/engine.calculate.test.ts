import { describe, expect, it } from "vitest";
import { calculateIndicator, D, registerCustomHandler } from "@/lib/engine";
import { input, rule } from "../helpers/fixtures";

const prop = (over = {}) =>
  rule({ indicatorCode: "P1", formulaType: "PROPORTIONAL", parameters: { numeratorKey: "spend", denominatorKey: "base", target: "0.06" }, ...over });

describe("PROPORTIONAL handler", () => {
  it("scores achievement / target × weighting", () => {
    const r = calculateIndicator(prop(), [input("spend", "30000"), input("base", "1000000")]);
    // actual 0.03, ratio 0.5, 10 × 0.5 = 5
    expect(r.status).toBe("CALCULATED");
    expect(r.points).toBe("5");
    expect(r.trace.actual).toBe("0.03");
    expect(r.trace.achievementRatio).toBe("0.5");
    expect(r.trace.recognisedAmount).toBe("30000");
  });

  it("caps at weighting by default and records raw points", () => {
    const r = calculateIndicator(prop(), [input("spend", "120000"), input("base", "1000000")]);
    expect(r.trace.rawPoints).toBe("20");
    expect(r.points).toBe("10");
    expect(r.trace.notes.some((n) => n.startsWith("Capped"))).toBe(true);
  });

  it("applies an explicit cap below weighting", () => {
    const r = calculateIndicator(prop({ cap: "7.5" }), [input("spend", "120000"), input("base", "1000000")]);
    expect(r.points).toBe("7.5");
  });

  it("uses exact decimal arithmetic (no float drift)", () => {
    const r = calculateIndicator(
      rule({ indicatorCode: "P2", formulaType: "PROPORTIONAL", parameters: { numeratorKey: "a", target: "3" }, weighting: "1" }),
      [input("a", "0.1")],
    );
    expect(r.trace.rawPoints).toBe(new D("0.1").dividedBy(3).toFixed());
    expect(r.trace.rawPoints).toMatch(/^0\.0(3){38}3*$/);
    // A float pipeline would give 0.1/3 = 0.03333333333333333 (17 digits) — reject that.
    expect(r.trace.rawPoints).not.toBe(String(0.1 / 3));
  });

  it("treats a zero denominator as zero achievement, not an error", () => {
    const r = calculateIndicator(prop(), [input("spend", "5"), input("base", "0")]);
    expect(r.points).toBe("0");
  });

  it("never scores negative points", () => {
    const r = calculateIndicator(prop(), [input("spend", "-100"), input("base", "1000")]);
    expect(r.points).toBe("0");
  });
});

describe("rounding", () => {
  const base = { indicatorCode: "R", formulaType: "PROPORTIONAL" as const, parameters: { numeratorKey: "a", target: "3" }, weighting: "10" };
  it.each([
    ["NONE", new D(10).dividedBy(3).toFixed()],
    ["HALF_UP_2DP", "3.33"],
    ["TRUNCATE_2DP", "3.33"],
    ["HALF_UP_0DP", "3"],
  ] as const)("%s", (method, expected) => {
    expect(calculateIndicator(rule({ ...base, roundingMethod: method }), [input("a", "1")]).points).toBe(expected);
  });
  it("HALF_UP_2DP rounds .005 up while TRUNCATE drops it", () => {
    const r = rule({ indicatorCode: "R2", formulaType: "BANDED", parameters: { inputKey: "x", bands: [{ min: "0", points: "2.345" }] } });
    expect(calculateIndicator({ ...r, roundingMethod: "HALF_UP_2DP" }, [input("x", "1")]).points).toBe("2.35");
    expect(calculateIndicator({ ...r, roundingMethod: "TRUNCATE_2DP" }, [input("x", "1")]).points).toBe("2.34");
  });
});

describe("BINARY_THRESHOLD and BANDED", () => {
  it("awards full weighting only when the threshold is met", () => {
    const r = rule({ indicatorCode: "B", formulaType: "BINARY_THRESHOLD", parameters: { inputKey: "x", threshold: "0.5", comparator: "GTE" }, weighting: "3" });
    expect(calculateIndicator(r, [input("x", "0.5")]).points).toBe("3");
    expect(calculateIndicator(r, [input("x", "0.4999")]).points).toBe("0");
  });

  it("selects the matching band with exclusive / inclusive upper bounds", () => {
    const r = rule({
      indicatorCode: "BD",
      formulaType: "BANDED",
      weighting: "5",
      parameters: { inputKey: "x", bands: [{ min: "0", max: "10", points: "1" }, { min: "10", max: "20", maxInclusive: true, points: "3" }, { min: "20.0001", points: "5" }] },
    });
    expect(calculateIndicator(r, [input("x", "9.99")]).points).toBe("1");
    expect(calculateIndicator(r, [input("x", "10")]).points).toBe("3");
    expect(calculateIndicator(r, [input("x", "20")]).points).toBe("3");
    expect(calculateIndicator(r, [input("x", "25")]).points).toBe("5");
    expect(calculateIndicator(r, [input("x", "-1")]).points).toBe("0");
  });
});

describe("bonus", () => {
  it("adds flat bonus points when the bonus threshold is met, separately from capped points", () => {
    const r = prop({ bonusRule: { type: "THRESHOLD_FLAT", inputKey: "jobs", threshold: "1", comparator: "GTE", points: "1" } });
    const res = calculateIndicator(r, [input("spend", "120000"), input("base", "1000000"), input("jobs", "3", { unit: "COUNT" })]);
    expect(res.points).toBe("10");
    expect(res.bonusPoints).toBe("1");
  });
  it("does not award bonus when the bonus input is unverified", () => {
    const r = prop({ bonusRule: { type: "THRESHOLD_FLAT", inputKey: "jobs", threshold: "1", comparator: "GTE", points: "1" } });
    const res = calculateIndicator(r, [input("spend", "1"), input("base", "10"), input("jobs", null)]);
    expect(res.bonusPoints).toBe("0");
  });
});

describe("fail-safe behaviour", () => {
  it("blocks rules that are not CONFIGURED from an approved source", () => {
    const r = calculateIndicator(prop({ configurationStatus: "REGULATORY_CONFIGURATION_REQUIRED" }), [input("spend", "1"), input("base", "1")]);
    expect(r.status).toBe("REGULATORY_CONFIGURATION_REQUIRED");
    expect(r.points).toBeNull();
  });

  it("never uses client claims when a verified value is missing", () => {
    const r = calculateIndicator(prop(), [input("spend", null, { clientClaim: "600000" }), input("base", "1000000")]);
    expect(r.status).toBe("INSUFFICIENT_INPUTS");
    expect(r.points).toBeNull();
    expect(r.trace.notes.join(" ")).toContain("INSUFFICIENT EVIDENCE TO VERIFY");
  });

  it("returns ERROR (not points) for malformed configuration", () => {
    const r = calculateIndicator(rule({ indicatorCode: "X", formulaType: "PROPORTIONAL", parameters: { numeratorKey: "a", target: "0" } }), [input("a", "1")]);
    expect(r.status).toBe("ERROR");
    expect(r.points).toBeNull();
  });

  it("returns ERROR for an unregistered custom handler", () => {
    const r = calculateIndicator(rule({ indicatorCode: "C", formulaType: "CUSTOM_HANDLER", parameters: { handler: "nope" } }), []);
    expect(r.status).toBe("ERROR");
  });

  it("supports explicitly registered custom handlers", async () => {
    registerCustomHandler("test-double", (_r, w) => ({ formula: "2 × weighting", target: null, actual: null, recognisedAmount: null, achievementRatio: null, rawPoints: w!.times(2), usedInputKeys: [], notes: [] }));
    const r = calculateIndicator(rule({ indicatorCode: "C2", formulaType: "CUSTOM_HANDLER", parameters: { handler: "test-double" }, cap: "15" }), []);
    expect(r.points).toBe("15");
    expect(new D(r.trace.rawPoints!).toNumber()).toBe(20);
  });
});

describe("trace and confidence", () => {
  it("records the full calculation trace and lineage ids", () => {
    const r = calculateIndicator(prop(), [input("spend", "30000", { calculationInputId: "ci-1" }), input("base", "1000000")]);
    expect(r.trace).toMatchObject({ formulaType: "PROPORTIONAL", target: "0.06", weighting: "10", cappedPoints: "5", result: "5", provisionIds: ["prov-test"] });
    expect(r.trace.inputs.find((i) => i.key === "spend")).toMatchObject({ calculationInputId: "ci-1", evidenceIds: ["ev-spend"] });
  });

  it("takes the weakest confidence of the inputs actually used", () => {
    const r = calculateIndicator(prop(), [input("spend", "1", { confidence: "LOW" }), input("base", "10"), input("unused", "1", { confidence: "UNVERIFIED" })]);
    expect(r.confidence).toBe("LOW");
  });
});
