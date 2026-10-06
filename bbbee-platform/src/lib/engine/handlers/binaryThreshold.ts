import { D, dec } from "../decimal";
import { COMPARATOR_SYMBOL, compare } from "../compare";
import { EngineConfigurationError, type BinaryThresholdParams } from "../types";
import { requireVerified } from "./inputs";
import type { FormulaHandler } from "./types";

/** points = weighting if (input <comparator> threshold) else 0 */
export const binaryThreshold: FormulaHandler = (rule, weighting, inputs) => {
  const p = rule.parameters as BinaryThresholdParams;
  if (!p.inputKey || p.threshold == null || !p.comparator) {
    throw new EngineConfigurationError(`BINARY_THRESHOLD rule ${rule.indicatorCode} requires inputKey, threshold, comparator`);
  }
  if (!weighting) throw new EngineConfigurationError(`BINARY_THRESHOLD rule ${rule.indicatorCode} requires a weighting`);
  const [value] = requireVerified(inputs, [p.inputKey]);
  const threshold = dec(p.threshold);
  const passed = compare(value!, p.comparator, threshold);
  return {
    formula: `weighting if ${p.inputKey} ${COMPARATOR_SYMBOL[p.comparator]} threshold else 0`,
    target: threshold,
    actual: value!,
    recognisedAmount: value!,
    achievementRatio: passed ? new D(1) : new D(0),
    rawPoints: passed ? weighting : new D(0),
    usedInputKeys: [p.inputKey],
    notes: [passed ? "Threshold met." : "Threshold not met."],
  };
};
