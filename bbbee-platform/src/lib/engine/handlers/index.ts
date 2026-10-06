import type { FormulaType } from "../types";
import { banded } from "./banded";
import { binaryThreshold } from "./binaryThreshold";
import { proportional } from "./proportional";
import type { FormulaHandler } from "./types";

export { InsufficientInputsError } from "./types";
export type { FormulaHandler, HandlerOutput } from "./types";

const builtIn: Record<Exclude<FormulaType, "CUSTOM_HANDLER">, FormulaHandler> = {
  PROPORTIONAL: proportional,
  BINARY_THRESHOLD: binaryThreshold,
  BANDED: banded,
};

/**
 * Named handlers for formulas that do not fit the reusable shapes (e.g. Ownership
 * net value). Each must be registered explicitly, reviewed, and covered by tests.
 */
const customHandlers = new Map<string, FormulaHandler>();

export function registerCustomHandler(name: string, handler: FormulaHandler): void {
  if (customHandlers.has(name)) throw new Error(`Custom handler ${name} already registered`);
  customHandlers.set(name, handler);
}

export function resolveHandler(formulaType: FormulaType, customName?: string): FormulaHandler | undefined {
  if (formulaType === "CUSTOM_HANDLER") return customName ? customHandlers.get(customName) : undefined;
  return builtIn[formulaType];
}
