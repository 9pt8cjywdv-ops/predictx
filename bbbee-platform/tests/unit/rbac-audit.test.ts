import { describe, expect, it } from "vitest";
import { computeAuditHash } from "@/lib/audit";
import { DEFAULT_ROLE_PERMISSIONS, Permission } from "@/lib/rbac/permissions";

describe("default RBAC matrix", () => {
  it("client users cannot see internal commentary, run calculations or review", () => {
    const c = DEFAULT_ROLE_PERMISSIONS.CLIENT_USER;
    for (const p of [Permission.INTERNAL_COMMENTARY_VIEW, Permission.CALCULATION_RUN, Permission.TECHNICAL_REVIEW, Permission.AUDIT_VIEW, Permission.REGULATORY_VIEW, Permission.CLIENT_VIEW]) {
      expect(c).not.toContain(p);
    }
    expect(c).toEqual(expect.arrayContaining([Permission.QUERY_RESPOND, Permission.DOCUMENT_UPLOAD]));
  });
  it("technical review is independent of preparation", () => {
    expect(DEFAULT_ROLE_PERMISSIONS.TECHNICAL_SIGNATORY).toContain(Permission.TECHNICAL_REVIEW);
    expect(DEFAULT_ROLE_PERMISSIONS.TECHNICAL_SIGNATORY).not.toContain(Permission.OVERRIDE_CREATE);
    expect(DEFAULT_ROLE_PERMISSIONS.TECHNICAL_SIGNATORY).not.toContain(Permission.CALCULATION_RUN);
    expect(DEFAULT_ROLE_PERMISSIONS.VERIFICATION_MANAGER).not.toContain(Permission.TECHNICAL_REVIEW);
    expect(DEFAULT_ROLE_PERMISSIONS.VERIFICATION_ANALYST).not.toContain(Permission.TECHNICAL_REVIEW);
  });
  it("only signatories and administrators may approve regulatory content", () => {
    const approvers = Object.entries(DEFAULT_ROLE_PERMISSIONS).filter(([, ps]) => ps.includes(Permission.REGULATORY_APPROVE)).map(([r]) => r);
    expect(approvers.sort()).toEqual(["ADMINISTRATOR", "TECHNICAL_SIGNATORY"]);
  });
  it("read-only reviewers cannot mutate anything", () => {
    const ro = DEFAULT_ROLE_PERMISSIONS.READ_ONLY_REVIEWER;
    expect(ro.every((p) => p.endsWith(":view") || p === Permission.INTERNAL_COMMENTARY_VIEW)).toBe(true);
  });
});

describe("audit hash chain", () => {
  const body = { eventType: "X", n: 1 };
  it("is deterministic and depends on the predecessor", () => {
    expect(computeAuditHash(null, body)).toBe(computeAuditHash(null, { n: 1, eventType: "X" }));
    expect(computeAuditHash("a", body)).not.toBe(computeAuditHash("b", body));
  });
  it("changes when any field changes", () => {
    expect(computeAuditHash(null, body)).not.toBe(computeAuditHash(null, { ...body, n: 2 }));
  });
});
