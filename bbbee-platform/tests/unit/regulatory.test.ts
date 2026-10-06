import { describe, expect, it } from "vitest";
import { checkCitations, HUMAN_CONFIRMATION_REQUIRED, type ProvisionRecord } from "@/lib/regulatory/citations";
import { canTransition, requiresApprovalAuthority, selectVersionForDate, windowsOverlap, type VersionWindow } from "@/lib/regulatory/versions";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const v = (id: string, from: string | null, to: string | null, status: VersionWindow["status"] = "PUBLISHED"): VersionWindow => ({ id, status, validFrom: from ? d(from) : null, validTo: to ? d(to) : null });

describe("regulatory version selection", () => {
  const versions = [v("old", "2015-01-01", "2020-01-01", "SUPERSEDED"), v("current", "2020-01-01", null), v("draft", "2027-01-01", null, "DRAFT")];

  it("applies the historical version to a historical period, never today's rules", () => {
    expect(selectVersionForDate(versions, d("2018-06-30"))?.id).toBe("old");
  });
  it("uses [validFrom, validTo) — the boundary day belongs to the new version", () => {
    expect(selectVersionForDate(versions, d("2019-12-31"))?.id).toBe("old");
    expect(selectVersionForDate(versions, d("2020-01-01"))?.id).toBe("current");
  });
  it("ignores drafts and returns null rather than falling back to the latest", () => {
    expect(selectVersionForDate(versions, d("2010-01-01"))).toBeNull();
    expect(selectVersionForDate([v("draft", "2000-01-01", null, "DRAFT")], d("2025-01-01"))).toBeNull();
  });
  it("ignores versions without a confirmed effective date", () => {
    expect(selectVersionForDate([v("x", null, null)], d("2025-01-01"))).toBeNull();
  });
  it("throws on overlapping in-force windows (configuration error)", () => {
    expect(() => selectVersionForDate([v("a", "2020-01-01", null), v("b", "2021-01-01", null)], d("2022-01-01"))).toThrow(/Overlapping/);
  });
  it("detects window overlap", () => {
    expect(windowsOverlap(v("a", "2020-01-01", "2021-01-01"), v("b", "2021-01-01", null))).toBe(false);
    expect(windowsOverlap(v("a", "2020-01-01", "2021-01-02"), v("b", "2021-01-01", null))).toBe(true);
  });
});

describe("regulatory workflow", () => {
  it("cannot publish without review and approval", () => {
    expect(canTransition("DRAFT", "PUBLISHED")).toBe(false);
    expect(canTransition("DRAFT", "APPROVED")).toBe(false);
    expect(canTransition("UNDER_REVIEW", "APPROVED")).toBe(true);
    expect(canTransition("APPROVED", "PUBLISHED")).toBe(true);
  });
  it("superseded and withdrawn are terminal", () => {
    expect(canTransition("SUPERSEDED", "PUBLISHED")).toBe(false);
    expect(canTransition("WITHDRAWN", "DRAFT")).toBe(false);
  });
  it("approval and publication need approval authority", () => {
    expect(requiresApprovalAuthority("APPROVED")).toBe(true);
    expect(requiresApprovalAuthority("PUBLISHED")).toBe(true);
    expect(requiresApprovalAuthority("UNDER_REVIEW")).toBe(false);
  });
});

describe("citation validation (no fabricated references)", () => {
  const rec = (over: Partial<ProvisionRecord> = {}): ProvisionRecord => ({
    id: "p1", reference: "S100-3.1", effectiveFrom: d("2020-01-01"), effectiveTo: null, status: "PUBLISHED", document: { title: "Codes", status: "PUBLISHED" }, ...over,
  });
  it("accepts an approved provision in effect", () => {
    expect(checkCitations(["p1"], [rec()], d("2024-01-01"))[0]).toMatchObject({ valid: true, reference: "S100-3.1" });
  });
  it("flags ids not in the library for human confirmation", () => {
    const [c] = checkCitations(["invented-gazette-123"], [], d("2024-01-01"));
    expect(c).toMatchObject({ valid: false });
    expect(c!.reason).toContain(HUMAN_CONFIRMATION_REQUIRED);
  });
  it("flags draft provisions and provisions not in effect", () => {
    expect(checkCitations(["p1"], [rec({ status: "DRAFT" })], d("2024-01-01"))[0]!.valid).toBe(false);
    expect(checkCitations(["p1"], [rec({ effectiveFrom: d("2025-01-01") })], d("2024-01-01"))[0]!.valid).toBe(false);
    expect(checkCitations(["p1"], [rec({ effectiveTo: d("2023-01-01") })], d("2024-01-01"))[0]!.valid).toBe(false);
  });
  it("de-duplicates repeated citations", () => {
    expect(checkCitations(["p1", "p1"], [rec()], d("2024-01-01"))).toHaveLength(1);
  });
});
