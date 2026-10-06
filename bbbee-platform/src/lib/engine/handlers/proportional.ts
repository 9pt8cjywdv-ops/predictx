import { D, dec } from "../decimal";
import { EngineConfigurationError, type ProportionalParams } from "../types";
import { requireVerified } from "./inputs";
import type { FormulaHandler } from "./types";

/**
 * points = min(actual / target, 1) × weighting   (cap handled by caller)
 * actual = numerator / denominator  when a denominator is configured.
 *
 * Achievement above target is not capped here so the raw figure is visible in
 * the trace; capping is applied uniformly in calculate.ts.
 */
export const proportional: FormulaHandler = (rule, weighting, inputs) => {
  const p = rule.parameters as ProportionalParams;
  if (!p.numeratorKey || p.target == null) {
    throw new EngineConfigurationError(`PROPORTIONAL rule ${rule.indicatorCode} requires numeratorKey and target`);
  }
  if (!weighting) throw new EngineConfigurationError(`PROPORTIONAL rule ${rule.indicatorCode} requires a weighting`);
  const target = dec(p.target);
  if (target.lessThanOrEqualTo(0)) throw new EngineConfigurationError(`Target must be positive for ${rule.indicatorCode}`);

  const keys = p.denominatorKey ? [p.numeratorKey, p.denominatorKey] : [p.numeratorKey];
  const [numerator, denominator] = requireVerified(inputs, keys);
  const notes: string[] = [];

  let actual = numerator!;
  if (denominator !== undefined) {
    if (denominator.isZero()) {
      notes.push(`Denominator ${p.denominatorKey} is zero; achievement treated as 0.`);
      actual = new D(0);
    } else {
      actual = numerator!.dividedBy(denominator);
    }
  }
  const achievementRatio = actual.dividedBy(target);
  const rawPoints = achievementRatio.times(weighting);

  const formula = p.denominatorKey
    ? `(${p.numeratorKey} ÷ ${p.denominatorKey}) ÷ target × weighting`
    : `${p.numeratorKey} ÷ target × weighting`;

  return {
    formula,
    target,
    actual,
    recognisedAmount: numerator!,
    achievementRatio,
    rawPoints,
    usedInputKeys: keys,
    notes,
  };
};
