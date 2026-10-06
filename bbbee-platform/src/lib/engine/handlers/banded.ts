import { dec } from "../decimal";
import { EngineConfigurationError, type BandedParams } from "../types";
import { requireVerified } from "./inputs";
import type { FormulaHandler } from "./types";

/** points = points of the first band where min ≤ input < max (or ≤ max when maxInclusive). */
export const banded: FormulaHandler = (rule, _weighting, inputs) => {
  const p = rule.parameters as BandedParams;
  if (!p.inputKey || !Array.isArray(p.bands) || p.bands.length === 0) {
    throw new EngineConfigurationError(`BANDED rule ${rule.indicatorCode} requires inputKey and at least one band`);
  }
  const [value] = requireVerified(inputs, [p.inputKey]);
  const band = p.bands.find((b) => {
    const aboveMin = value!.greaterThanOrEqualTo(dec(b.min));
    if (b.max === undefined) return aboveMin;
    const max = dec(b.max);
    return aboveMin && (b.maxInclusive ? value!.lessThanOrEqualTo(max) : value!.lessThan(max));
  });
  const points = band ? dec(band.points) : dec(0);
  return {
    formula: `band lookup on ${p.inputKey}`,
    target: null,
    actual: value!,
    recognisedAmount: value!,
    achievementRatio: null,
    rawPoints: points,
    usedInputKeys: [p.inputKey],
    notes: [band ? `Matched band [${band.min}, ${band.max ?? "∞"}${band.maxInclusive ? "]" : ")"} → ${band.points}` : "No band matched; 0 points."],
  };
};
