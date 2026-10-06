import { describe, expect, it } from "vitest";
import { addMonths, affidavitValidityOn, certificateValidityOn, classifyEntity, isWithinPeriod, type ClassificationThresholds } from "@/lib/engine";
import { TEST_VERSION } from "../helpers/fixtures";

describe("entity classification (turnover thresholds are configuration)", () => {
  const t: ClassificationThresholds = {
    regulatoryVersionId: TEST_VERSION,
    sectorCode: null,
    configurationStatus: "CONFIGURED",
    emeMaxTurnover: "1000",
    qseMaxTurnover: "5000",
    upperBoundInclusive: true,
    provisionIds: [],
  };
  it.each([
    ["0", "EME"], ["1000", "EME"], ["1000.01", "QSE"], ["5000", "QSE"], ["5000.01", "GENERIC"],
  ])("turnover %s → %s (inclusive bounds)", (tv, cls) => {
    expect(classifyEntity(tv, t).classification).toBe(cls);
  });
  it("respects exclusive upper bounds", () => {
    expect(classifyEntity("1000", { ...t, upperBoundInclusive: false }).classification).toBe("QSE");
  });
  it("is UNDETERMINED without configuration or verified turnover", () => {
    expect(classifyEntity("1", { ...t, configurationStatus: "REGULATORY_CONFIGURATION_REQUIRED" })).toMatchObject({ classification: "UNDETERMINED", status: "REGULATORY_CONFIGURATION_REQUIRED" });
    expect(classifyEntity(null, t)).toMatchObject({ classification: "UNDETERMINED", status: "INSUFFICIENT_EVIDENCE" });
  });
  it("rejects negative turnover and inverted thresholds", () => {
    expect(() => classifyEntity("-1", t)).toThrow();
    expect(() => classifyEntity("1", { ...t, emeMaxTurnover: "6000" })).toThrow();
  });
});

describe("date validity", () => {
  const period = { start: new Date("2025-03-01"), end: new Date("2026-02-28") };
  it("includes both period bounds", () => {
    expect(isWithinPeriod("2025-03-01", period)).toBe(true);
    expect(isWithinPeriod("2026-02-28", period)).toBe(true);
    expect(isWithinPeriod("2026-03-01", period)).toBe(false);
    expect(isWithinPeriod("2025-02-28", period)).toBe(false);
  });
  it("ignores time-of-day", () => {
    expect(isWithinPeriod(new Date("2026-02-28T23:59:59Z"), period)).toBe(true);
  });
  it("rejects invalid dates", () => {
    expect(() => isWithinPeriod("not-a-date", period)).toThrow();
  });
  it("addMonths clamps to month end", () => {
    expect(addMonths(new Date("2025-01-31"), 1).toISOString().slice(0, 10)).toBe("2025-02-28");
    expect(addMonths(new Date("2024-01-31"), 1).toISOString().slice(0, 10)).toBe("2024-02-29");
    expect(addMonths(new Date("2025-03-15"), 12).toISOString().slice(0, 10)).toBe("2026-03-15");
  });
});

describe("certificate validity", () => {
  const cert = { issueDate: "2025-01-10", expiryDate: "2026-01-09" };
  it.each([
    ["2025-06-01", "VALID"], ["2026-01-09", "VALID"], ["2026-01-10", "EXPIRED"], ["2025-01-09", "NOT_YET_VALID"],
  ])("on %s → %s", (on, expected) => expect(certificateValidityOn(cert, on)).toBe(expected));
  it("flags missing and inverted dates", () => {
    expect(certificateValidityOn({ issueDate: "2025-01-01" }, "2025-06-01")).toBe("MISSING_DATES");
    expect(certificateValidityOn({ issueDate: "2025-01-01", expiryDate: "2024-01-01" }, "2025-06-01")).toBe("INVALID_DATES");
  });
});

describe("affidavit validity", () => {
  const ok = { signedByDeponent: true, commissioned: true, commissionedDate: "2025-04-01", validityMonths: 12 };
  it("is valid within the configured window and expired after", () => {
    expect(affidavitValidityOn(ok, "2026-04-01")).toBe("VALID");
    expect(affidavitValidityOn(ok, "2026-04-02")).toBe("EXPIRED");
  });
  it("detects unsigned and uncommissioned affidavits", () => {
    expect(affidavitValidityOn({ ...ok, signedByDeponent: false }, "2025-05-01")).toBe("UNSIGNED");
    expect(affidavitValidityOn({ ...ok, commissioned: false }, "2025-05-01")).toBe("NOT_COMMISSIONED");
  });
  it("requires regulatory configuration for the validity period", () => {
    expect(affidavitValidityOn({ ...ok, validityMonths: null }, "2025-05-01")).toBe("REGULATORY_CONFIGURATION_REQUIRED");
  });
});
