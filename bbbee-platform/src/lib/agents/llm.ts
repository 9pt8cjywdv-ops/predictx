import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { env } from "../env";

export interface StructuredRequest<S extends z.ZodType> {
  /** Stable system prompt — kept byte-identical across calls for prompt caching. */
  system: string;
  /** Operator task + wrapped untrusted documents. */
  userContent: string;
  schema: S;
  maxTokens?: number;
}

export interface StructuredResponse {
  /** Raw parsed JSON — always re-validated by the runner. */
  output: unknown;
  model: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string | null;
}

export interface LlmClient {
  generateStructured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<StructuredResponse>;
}

export class LlmRefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmRefusalError";
  }
}

/** Claude via the official SDK, using structured outputs (JSON schema constrained decoding). */
export class AnthropicLlmClient implements LlmClient {
  private readonly client: Anthropic;
  constructor(private readonly model = env().AGENT_MODEL, private readonly effort = env().AGENT_EFFORT) {
    this.client = new Anthropic();
  }

  async generateStructured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<StructuredResponse> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: req.maxTokens ?? 16000,
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: req.userContent }],
      output_config: { format: zodOutputFormat(req.schema), effort: this.effort },
    });
    if (response.stop_reason === "refusal") throw new LlmRefusalError("Model declined the request.");
    if (response.stop_reason === "max_tokens") throw new Error("Agent output truncated (max_tokens).");
    return {
      output: response.parsed_output,
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      stopReason: response.stop_reason,
    };
  }
}

let client: LlmClient | undefined;

export function llmClient(): LlmClient {
  if (!client) {
    if (!env().ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured; AI agents are disabled.");
    client = new AnthropicLlmClient();
  }
  return client;
}

export function setLlmClientForTesting(c: LlmClient | undefined): void {
  client = c;
}
