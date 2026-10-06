import type { AgentType } from "@prisma/client";
import type { z } from "zod";
import { codeApplicabilityAgent } from "./definitions/codeApplicability";
import { documentEvidenceAgent } from "./definitions/documentEvidence";
import { elementAgents } from "./definitions/elementAgents";
import type { AgentDefinition } from "./types";

export const AGENTS: Partial<Record<AgentType, AgentDefinition<z.ZodType>>> = {
  DOCUMENT_EVIDENCE_AGENT: documentEvidenceAgent as AgentDefinition<z.ZodType>,
  CODE_APPLICABILITY_AGENT: codeApplicabilityAgent as AgentDefinition<z.ZodType>,
  ...(elementAgents as Record<string, AgentDefinition<z.ZodType>>),
};

export * from "./contracts";
export * from "./types";
export { runAgent, executeAgent, prepareInput, postValidate } from "./runner";
