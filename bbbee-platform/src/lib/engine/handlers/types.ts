import type { Dec } from "../decimal";
import type { EngineInput, RuleConfig } from "../types";

export class InsufficientInputsError extends Error {
  constructor(public readonly missingKeys: string[]) {
    super(`Insufficient verified inputs: ${missingKeys.join(", ")}`);
    this.name = "InsufficientInputsError";
  }
}

export interface HandlerOutput {
  formula: string;
  target: Dec | null;
  actual: Dec | null;
  recognisedAmount: Dec | null;
  achievementRatio: Dec | null;
  rawPoints: Dec;
  usedInputKeys: string[];
  notes: string[];
}

export type FormulaHandler = (rule: RuleConfig, weighting: Dec | null, inputs: Map<string, EngineInput>) => HandlerOutput;
