import type { Role } from "@prisma/client";

export const Permission = {
  CLIENT_VIEW: "client:view",
  CLIENT_MANAGE: "client:manage",
  ENGAGEMENT_VIEW: "engagement:view",
  ENGAGEMENT_MANAGE: "engagement:manage",
  DOCUMENT_UPLOAD: "document:upload",
  DOCUMENT_CLASSIFY: "document:classify",
  DOCUMENT_DELETE: "document:delete",
  EVIDENCE_CONFIRM: "evidence:confirm",
  OVERRIDE_CREATE: "override:create",
  CALCULATION_RUN: "calculation:run",
  AGENT_RUN: "agent:run",
  QUERY_MANAGE: "query:manage",
  QUERY_RESPOND: "query:respond",
  INTERNAL_COMMENTARY_VIEW: "commentary:view-internal",
  TECHNICAL_REVIEW: "review:technical",
  ENGAGEMENT_SUBMIT_FOR_REVIEW: "engagement:submit-review",
  REPORT_GENERATE: "report:generate",
  AUDIT_VIEW: "audit:view",
  REGULATORY_VIEW: "regulatory:view",
  REGULATORY_MANAGE: "regulatory:manage",
  REGULATORY_APPROVE: "regulatory:approve",
  USER_MANAGE: "user:manage",
  SCENARIO_MODEL: "scenario:model",
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

export const ALL_PERMISSIONS = Object.values(Permission);

const P = Permission;

/**
 * Default matrix, seeded per organisation into RolePermission and editable by
 * administrators. Note: TECHNICAL_REVIEW is deliberately separated from the
 * roles that prepare the verification (independence of review).
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  ADMINISTRATOR: [...ALL_PERMISSIONS],
  VERIFICATION_MANAGER: [
    P.CLIENT_VIEW, P.CLIENT_MANAGE, P.ENGAGEMENT_VIEW, P.ENGAGEMENT_MANAGE, P.DOCUMENT_UPLOAD,
    P.DOCUMENT_CLASSIFY, P.DOCUMENT_DELETE, P.EVIDENCE_CONFIRM, P.OVERRIDE_CREATE, P.CALCULATION_RUN,
    P.AGENT_RUN, P.QUERY_MANAGE, P.INTERNAL_COMMENTARY_VIEW, P.ENGAGEMENT_SUBMIT_FOR_REVIEW,
    P.REPORT_GENERATE, P.AUDIT_VIEW, P.REGULATORY_VIEW, P.SCENARIO_MODEL,
  ],
  VERIFICATION_ANALYST: [
    P.CLIENT_VIEW, P.ENGAGEMENT_VIEW, P.DOCUMENT_UPLOAD, P.DOCUMENT_CLASSIFY, P.EVIDENCE_CONFIRM,
    P.CALCULATION_RUN, P.AGENT_RUN, P.QUERY_MANAGE, P.INTERNAL_COMMENTARY_VIEW, P.REGULATORY_VIEW,
    P.SCENARIO_MODEL,
  ],
  TECHNICAL_SIGNATORY: [
    P.CLIENT_VIEW, P.ENGAGEMENT_VIEW, P.INTERNAL_COMMENTARY_VIEW, P.TECHNICAL_REVIEW, P.AUDIT_VIEW,
    P.REGULATORY_VIEW, P.REGULATORY_APPROVE, P.REPORT_GENERATE,
  ],
  READ_ONLY_REVIEWER: [P.CLIENT_VIEW, P.ENGAGEMENT_VIEW, P.INTERNAL_COMMENTARY_VIEW, P.AUDIT_VIEW, P.REGULATORY_VIEW],
  CLIENT_USER: [P.ENGAGEMENT_VIEW, P.DOCUMENT_UPLOAD, P.QUERY_RESPOND],
};
