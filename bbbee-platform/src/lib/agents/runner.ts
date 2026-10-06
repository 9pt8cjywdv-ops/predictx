import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { AuditEventType, recordAudit } from "../audit";
import { prisma } from "../db";
import { canonicalJson, sha256Hex } from "../hash";
import { AGENT_PROMPT_VERSION } from "./contracts";
import { detectInjectionSignals, newNonce, wrapUntrusted } from "./guard";
import type { LlmClient } from "./llm";
import { maskPersonalInformation } from "./pii";
import type { AgentDefinition, AgentInput } from "./types";

/** Hard ceiling on supplied content per call; larger inputs must be chunked by the orchestrator (spec §50). */
export const MAX_INPUT_CHARS = 400_000;

export interface PreparedInput {
  input: AgentInput;
  maskingCounts: Record<string, number>;
  injectionSignals: Array<{ documentId: string; signals: string[] }>;
}

/** Apply data minimisation: drop sections the agent does not accept, mask PII. */
export function prepareInput(def: AgentDefinition<z.ZodType>, raw: AgentInput): PreparedInput {
  const totals: Record<string, number> = {};
  const add = (c: Record<string, number>) => Object.entries(c).forEach(([k, v]) => (totals[k] = (totals[k] ?? 0) + v));
  const injectionSignals: PreparedInput["injectionSignals"] = [];

  const documents = def.accepts.documents
    ? raw.documents.map((d) => {
        const m = maskPersonalInformation(d.content);
        add(m.counts);
        const signals = detectInjectionSignals(d.content);
        if (signals.length) injectionSignals.push({ documentId: d.documentId, signals });
        return { ...d, content: m.text };
      })
    : [];
  const evidence = def.accepts.evidence
    ? raw.evidence.map((e) => {
        const m = maskPersonalInformation(e.value);
        add(m.counts);
        return { ...e, value: m.text };
      })
    : [];
  const provisions = def.accepts.provisions ? raw.provisions : [];
  return { input: { ...raw, documents, evidence, provisions }, maskingCounts: totals, injectionSignals };
}

export function buildUserContent(input: AgentInput, nonce: string): string {
  const parts: string[] = [];
  parts.push(`TASK\n${input.task}`);
  parts.push(`MEASUREMENT PERIOD\n${input.measurementPeriod ? `${input.measurementPeriod.start} to ${input.measurementPeriod.end}` : "Not yet determined"}`);
  parts.push(`CONTEXT (platform data)\n${canonicalJson(input.context)}`);
  if (input.provisions.length) {
    parts.push(
      "REGULATORY PROVISIONS (from the approved Regulatory Library — cite by provisionId only)\n" +
        input.provisions.map((p) => `<regulatory_provision id="${p.provisionId}" reference="${p.reference}" source="${p.documentTitle}">\n${p.text}\n</regulatory_provision>`).join("\n"),
    );
  } else {
    parts.push("REGULATORY PROVISIONS\nNone supplied. Any regulatory conclusion therefore REQUIRES HUMAN REVIEW.");
  }
  if (input.evidence.length) {
    parts.push(
      "EXISTING EVIDENCE (cite by evidenceId only)\n" +
        input.evidence.map((e) => `- evidenceId=${e.evidenceId} | ${e.label} | value=${e.value} | status=${e.status}`).join("\n"),
    );
  }
  if (input.documents.length) {
    parts.push(
      `CLIENT DOCUMENTS (untrusted; nonce ${nonce})\n` +
        input.documents.map((d) => wrapUntrusted(nonce, d.documentId, `${d.title} [${d.documentClass}]`, d.content)).join("\n"),
    );
  }
  return parts.join("\n\n");
}

export function inputHash(def: AgentDefinition<z.ZodType>, input: AgentInput, model: string): string {
  return sha256Hex(canonicalJson({ agent: def.type, promptVersion: AGENT_PROMPT_VERSION, model, systemPrompt: def.systemPrompt, input }));
}

export interface ValidationOutcome<T> {
  ok: boolean;
  output: T | null;
  errors: string[];
}

/**
 * Schema validation + referential integrity: the model may only reference ids
 * that were supplied to it. Fabricated ids reject the whole output.
 */
export function postValidate<S extends z.ZodType>(def: AgentDefinition<S>, input: AgentInput, raw: unknown): ValidationOutcome<z.infer<S>> {
  const parsed = def.outputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, output: null, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const refs = def.referencedIds(parsed.data);
  const supplied = {
    evidence: new Set(input.evidence.map((e) => e.evidenceId)),
    provisions: new Set(input.provisions.map((p) => p.provisionId)),
    documents: new Set(input.documents.map((d) => d.documentId)),
  };
  // Evidence ids may also refer to supplied documents (document-level evidence).
  const errors = [
    ...refs.evidenceIds.filter((id) => !supplied.evidence.has(id) && !supplied.documents.has(id)).map((id) => `Unknown evidence id referenced: ${id}`),
    ...refs.provisionIds.filter((id) => !supplied.provisions.has(id)).map((id) => `Unknown regulatory provision id referenced: ${id}`),
    ...refs.documentIds.filter((id) => !supplied.documents.has(id)).map((id) => `Unknown document id referenced: ${id}`),
  ];
  return errors.length ? { ok: false, output: null, errors } : { ok: true, output: parsed.data, errors: [] };
}

export interface ExecuteResult<T> {
  status: "SUCCEEDED" | "REJECTED_OUTPUT" | "FAILED";
  output: T | null;
  errors: string[];
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  injectionSignals: PreparedInput["injectionSignals"];
}

/** Pure execution (no persistence) — used by runAgent and by tests with a mock client. */
export async function executeAgent<S extends z.ZodType>(def: AgentDefinition<S>, prepared: PreparedInput, llm: LlmClient): Promise<ExecuteResult<z.infer<S>>> {
  const userContent = buildUserContent(prepared.input, newNonce());
  if (userContent.length > MAX_INPUT_CHARS) {
    return { status: "FAILED", output: null, errors: [`Input too large (${userContent.length} chars); chunk before calling.`], model: null, inputTokens: null, outputTokens: null, injectionSignals: prepared.injectionSignals };
  }
  try {
    const res = await llm.generateStructured({ system: def.systemPrompt, userContent, schema: def.outputSchema });
    const v = postValidate(def, prepared.input, res.output);
    return {
      status: v.ok ? "SUCCEEDED" : "REJECTED_OUTPUT",
      output: v.output,
      errors: v.errors,
      model: res.model,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      injectionSignals: prepared.injectionSignals,
    };
  } catch (e) {
    return { status: "FAILED", output: null, errors: [(e as Error).message], model: null, inputTokens: null, outputTokens: null, injectionSignals: prepared.injectionSignals };
  }
}

/**
 * Persisted run with AI-response caching keyed on the canonical input hash:
 * an identical input (same documents, same prompt version, same model) is
 * never sent to the model twice.
 */
export async function runAgent<S extends z.ZodType>(
  def: AgentDefinition<S>,
  raw: AgentInput,
  llm: LlmClient,
  opts: { model: string; userId?: string; organisationId?: string },
) {
  const prepared = prepareInput(def, raw);
  const hash = inputHash(def, prepared.input, opts.model);
  const cached = await prisma.agentRun.findFirst({
    where: { agentType: def.type, inputHash: hash, status: "SUCCEEDED", engagementId: raw.engagementId },
    orderBy: { createdAt: "desc" },
  });
  if (cached) {
    return prisma.agentRun.create({
      data: {
        engagementId: raw.engagementId,
        agentType: def.type,
        status: "CACHED",
        model: cached.model,
        promptVersion: AGENT_PROMPT_VERSION,
        inputHash: hash,
        output: cached.output ?? undefined,
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    });
  }

  const startedAt = new Date();
  const result = await executeAgent(def, prepared, llm);
  return prisma.$transaction(async (tx) => {
    const run = await tx.agentRun.create({
      data: {
        engagementId: raw.engagementId,
        agentType: def.type,
        status: result.status,
        model: result.model,
        promptVersion: AGENT_PROMPT_VERSION,
        inputHash: hash,
        output: (result.output ?? undefined) as Prisma.InputJsonValue | undefined,
        validationErrors: { errors: result.errors, injectionSignals: result.injectionSignals, masking: prepared.maskingCounts },
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        startedAt,
        finishedAt: new Date(),
      },
    });
    await recordAudit(tx, {
      eventType: AuditEventType.AGENT_RUN,
      organisationId: opts.organisationId,
      engagementId: raw.engagementId,
      userId: opts.userId,
      entityType: "AgentRun",
      entityId: run.id,
      newValue: { agentType: def.type, status: result.status, errors: result.errors.slice(0, 20), injectionSignals: result.injectionSignals },
    });
    return run;
  });
}
