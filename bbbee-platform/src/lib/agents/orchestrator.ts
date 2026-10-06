import type { AgentType } from "@prisma/client";

/**
 * Static, acyclic pipeline (spec §49). Agents cannot invoke other agents; the
 * orchestrator is the only scheduler and it walks this DAG once per trigger.
 */
export type StageId =
  | "DOCUMENT_EVIDENCE"
  | "CODE_APPLICABILITY"
  | "OWNERSHIP"
  | "MANAGEMENT_CONTROL"
  | "SKILLS"
  | "PROCUREMENT"
  | "ESD"
  | "SED"
  | "CALCULATION"
  | "VERIFICATION_MANAGER"
  | "TECHNICAL_REVIEW"
  | "HUMAN_APPROVAL";

export interface Stage {
  id: StageId;
  kind: "AGENT" | "ENGINE" | "HUMAN";
  agentType?: AgentType;
  dependsOn: StageId[];
  /** Document classes whose arrival invalidates this stage (incremental reassessment, spec §32). */
  triggeredBy: string[];
  availableFromPhase: number;
}

const ELEMENT_DEPS: StageId[] = ["DOCUMENT_EVIDENCE", "CODE_APPLICABILITY"];

export const PIPELINE: Stage[] = [
  { id: "DOCUMENT_EVIDENCE", kind: "AGENT", agentType: "DOCUMENT_EVIDENCE_AGENT", dependsOn: [], triggeredBy: ["*"], availableFromPhase: 2 },
  { id: "CODE_APPLICABILITY", kind: "AGENT", agentType: "CODE_APPLICABILITY_AGENT", dependsOn: ["DOCUMENT_EVIDENCE"], triggeredBy: ["CIPC", "FINANCIAL_STATEMENTS", "MANAGEMENT_ACCOUNTS", "TRIAL_BALANCE"], availableFromPhase: 2 },
  { id: "OWNERSHIP", kind: "AGENT", agentType: "OWNERSHIP_AGENT", dependsOn: ELEMENT_DEPS, triggeredBy: ["CIPC", "SHARE_REGISTER", "SHARE_CERTIFICATE", "SHAREHOLDER_AGREEMENT", "MOI", "TRUST_DEED", "BENEFICIARY_DOCUMENTATION"], availableFromPhase: 4 },
  { id: "MANAGEMENT_CONTROL", kind: "AGENT", agentType: "MANAGEMENT_CONTROL_AGENT", dependsOn: ELEMENT_DEPS, triggeredBy: ["EMPLOYEE_LISTING", "PAYROLL", "EEA2", "EEA4", "ORGANOGRAM"], availableFromPhase: 4 },
  { id: "SKILLS", kind: "AGENT", agentType: "SKILLS_AGENT", dependsOn: ELEMENT_DEPS, triggeredBy: ["PAYROLL", "WSP", "ATR", "TRAINING_INVOICE", "PROOF_OF_PAYMENT", "LEARNERSHIP_AGREEMENT", "BURSARY_AGREEMENT"], availableFromPhase: 4 },
  { id: "PROCUREMENT", kind: "AGENT", agentType: "PROCUREMENT_AGENT", dependsOn: ELEMENT_DEPS, triggeredBy: ["SUPPLIER_LISTING", "SUPPLIER_CERTIFICATE", "AFFIDAVIT", "GENERAL_LEDGER", "TRIAL_BALANCE"], availableFromPhase: 4 },
  { id: "ESD", kind: "AGENT", agentType: "ESD_AGENT", dependsOn: ELEMENT_DEPS, triggeredBy: ["SUPPLIER_DEVELOPMENT", "ENTERPRISE_DEVELOPMENT", "PROOF_OF_PAYMENT", "CONFIRMATION_LETTER"], availableFromPhase: 4 },
  { id: "SED", kind: "AGENT", agentType: "SED_AGENT", dependsOn: ELEMENT_DEPS, triggeredBy: ["SED_DOCUMENTATION", "PROOF_OF_PAYMENT", "CONFIRMATION_LETTER"], availableFromPhase: 4 },
  { id: "CALCULATION", kind: "ENGINE", dependsOn: ["OWNERSHIP", "MANAGEMENT_CONTROL", "SKILLS", "PROCUREMENT", "ESD", "SED"], triggeredBy: [], availableFromPhase: 3 },
  { id: "VERIFICATION_MANAGER", kind: "AGENT", agentType: "VERIFICATION_MANAGER_AGENT", dependsOn: ["CALCULATION"], triggeredBy: [], availableFromPhase: 4 },
  { id: "TECHNICAL_REVIEW", kind: "AGENT", agentType: "TECHNICAL_REVIEW_AGENT", dependsOn: ["VERIFICATION_MANAGER"], triggeredBy: [], availableFromPhase: 6 },
  { id: "HUMAN_APPROVAL", kind: "HUMAN", dependsOn: ["TECHNICAL_REVIEW"], triggeredBy: [], availableFromPhase: 1 },
];

export function assertAcyclic(stages: Stage[] = PIPELINE): StageId[] {
  const byId = new Map(stages.map((s) => [s.id, s]));
  const order: StageId[] = [];
  const state = new Map<StageId, "visiting" | "done">();
  const visit = (id: StageId, path: StageId[]) => {
    const st = state.get(id);
    if (st === "done") return;
    if (st === "visiting") throw new Error(`Pipeline cycle: ${[...path, id].join(" → ")}`);
    const stage = byId.get(id);
    if (!stage) throw new Error(`Unknown stage ${id}`);
    state.set(id, "visiting");
    stage.dependsOn.forEach((d) => visit(d, [...path, id]));
    state.set(id, "done");
    order.push(id);
  };
  stages.forEach((s) => visit(s.id, []));
  return order;
}

/**
 * Stages to re-run when new documents of the given classes arrive: directly
 * triggered stages plus everything downstream of them — nothing else.
 */
export function stagesAffectedBy(documentClasses: string[], stages: Stage[] = PIPELINE): StageId[] {
  const direct = new Set(stages.filter((s) => s.triggeredBy.includes("*") ? documentClasses.length > 0 : s.triggeredBy.some((c) => documentClasses.includes(c))).map((s) => s.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of stages) {
      if (!direct.has(s.id) && s.dependsOn.some((d) => direct.has(d))) {
        direct.add(s.id);
        changed = true;
      }
    }
  }
  return assertAcyclic(stages).filter((id) => direct.has(id));
}

/** Incremental variant that excludes the catch-all DOCUMENT_EVIDENCE fan-out (used once evidence is already extracted). */
export function elementStagesAffectedBy(documentClasses: string[]): StageId[] {
  const withoutCatchAll = PIPELINE.map((s) => (s.id === "DOCUMENT_EVIDENCE" ? { ...s, triggeredBy: [] } : s));
  return stagesAffectedBy(documentClasses, withoutCatchAll);
}
