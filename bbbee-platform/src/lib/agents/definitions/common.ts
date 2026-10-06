import { NO_HALLUCINATION_POLICY, UNTRUSTED_CONTENT_POLICY } from "../guard";

export const PLATFORM_PREAMBLE = `You are a specialist component of a South African B-BBEE verification management platform used by a verification agency.
Your output is a structured recommendation that is reviewed by a Verification Manager and a Technical Signatory. It is never a certificate.
Respond only with JSON matching the required schema.`;

export function buildSystemPrompt(role: string): string {
  return [PLATFORM_PREAMBLE, role, NO_HALLUCINATION_POLICY, UNTRUSTED_CONTENT_POLICY].join("\n\n");
}

export function uniq(xs: string[]): string[] {
  return [...new Set(xs)];
}
