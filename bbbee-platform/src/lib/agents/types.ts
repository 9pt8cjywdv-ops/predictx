import type { AgentType } from "@prisma/client";
import type { z } from "zod";

/** Material passed to an agent. Content is already minimised and PII-masked. */
export interface AgentDocument {
  documentId: string;
  title: string;
  documentClass: string;
  content: string;
}

export interface AgentProvision {
  provisionId: string;
  reference: string;
  documentTitle: string;
  text: string;
}

export interface AgentEvidence {
  evidenceId: string;
  label: string;
  value: string;
  status: string;
}

export interface AgentInput {
  engagementId: string;
  task: string;
  measurementPeriod: { start: string; end: string } | null;
  documents: AgentDocument[];
  provisions: AgentProvision[];
  evidence: AgentEvidence[];
  context: Record<string, unknown>;
}

export interface AgentDefinition<S extends z.ZodType> {
  type: AgentType;
  description: string;
  systemPrompt: string;
  outputSchema: S;
  /** Which input sections this agent may receive (data minimisation). */
  accepts: { documents: boolean; provisions: boolean; evidence: boolean };
  /** Collects every evidence / provision / document id referenced by an output. */
  referencedIds(output: z.infer<S>): { evidenceIds: string[]; provisionIds: string[]; documentIds: string[] };
}
