import { compare } from "./compare";
import { weakestConfidence } from "./confidence";
import { applyRounding, D, dec, minDec, s, type Dec } from "./decimal";
import { InsufficientInputsError, resolveHandler } from "./handlers";
import {
  CONFIGURED,
  ENGINE_VERSION,
  EngineConfigurationError,
  type CalculationTrace,
  type CustomHandlerParams,
  type EngineInput,
  type IndicatorResult,
  type RuleConfig,
} from "./types";

function emptyTrace(rule: RuleConfig, inputs: EngineInput[]): CalculationTrace {
  return {
    engineVersion: ENGINE_VERSION,
    ruleId: rule.ruleId,
    regulatoryVersionId: rule.regulatoryVersionId,
    indicatorCode: rule.indicatorCode,
    formulaType: rule.formulaType,
    formula: "",
    inputs: inputs.map(({ key, unit, verifiedValue, clientClaim, confidence, evidenceIds, calculationInputId }) => ({
      key,
      unit,
      verifiedValue,
      clientClaim: clientClaim ?? null,
      confidence,
      evidenceIds,
      calculationInputId,
    })),
    target: null,
    actual: null,
    recognisedAmount: null,
    achievementRatio: null,
    weighting: rule.weighting,
    rawPoints: null,
    cappedPoints: null,
    bonusPoints: null,
    roundingMethod: rule.roundingMethod,
    result: null,
    provisionIds: rule.provisionIds,
    notes: [],
  };
}

function computeBonus(rule: RuleConfig, inputs: Map<string, EngineInput>, notes: string[]): Dec {
  const b = rule.bonusRule;
  if (!b || b.type === "NONE") return new D(0);
  if (b.type === "THRESHOLD_FLAT") {
    const v = inputs.get(b.inputKey)?.verifiedValue;
    if (v == null || v === "") {
      notes.push(`Bonus not assessed: verified input ${b.inputKey} missing.`);
      return new D(0);
    }
    const met = compare(dec(v), b.comparator, dec(b.threshold));
    notes.push(met ? `Bonus threshold met on ${b.inputKey}.` : `Bonus threshold not met on ${b.inputKey}.`);
    return met ? dec(b.points) : new D(0);
  }
  throw new EngineConfigurationError(`Unknown bonus rule on ${rule.indicatorCode}`);
}

/**
 * Deterministically calculate one indicator.
 *
 * Fails safe: a rule not marked CONFIGURED (i.e. not tied to an approved,
 * authoritative regulatory source) never produces points.
 */
export function calculateIndicator(rule: RuleConfig, inputList: EngineInput[]): IndicatorResult {
  const trace = emptyTrace(rule, inputList);
  const inputs = new Map(inputList.map((i) => [i.key, i]));
  const base = { indicatorCode: rule.indicatorCode, element: rule.element };

  if (rule.configurationStatus !== CONFIGURED) {
    trace.notes.push("REGULATORY_CONFIGURATION_REQUIRED: rule parameters have not been sourced from an approved regulatory document.");
    return { ...base, status: "REGULATORY_CONFIGURATION_REQUIRED", points: null, bonusPoints: null, confidence: "UNVERIFIED", trace };
  }

  try {
    const customName = rule.formulaType === "CUSTOM_HANDLER" ? (rule.parameters as CustomHandlerParams).handler : undefined;
    const handler = resolveHandler(rule.formulaType, customName);
    if (!handler) throw new EngineConfigurationError(`No handler for ${rule.formulaType}${customName ? `:${customName}` : ""}`);

    const weighting = rule.weighting != null ? dec(rule.weighting) : null;
    const out = handler(rule, weighting, inputs);

    const capValue = rule.cap != null ? dec(rule.cap) : weighting;
    const nonNegative = out.rawPoints.isNegative() ? new D(0) : out.rawPoints;
    const capped = capValue ? minDec(nonNegative, capValue) : nonNegative;
    const bonus = computeBonus(rule, inputs, trace.notes);
    const rounded = applyRounding(capped, rule.roundingMethod);
    const roundedBonus = applyRounding(bonus, rule.roundingMethod);

    Object.assign(trace, {
      formula: out.formula,
      target: s(out.target),
      actual: s(out.actual),
      recognisedAmount: s(out.recognisedAmount),
      achievementRatio: s(out.achievementRatio),
      rawPoints: s(out.rawPoints),
      cappedPoints: s(capped),
      bonusPoints: s(roundedBonus),
      result: s(rounded),
    });
    trace.notes.push(...out.notes);
    if (capValue && nonNegative.greaterThan(capValue)) trace.notes.push(`Capped at ${capValue.toFixed()}.`);

    const used = out.usedInputKeys.map((k) => inputs.get(k)!.confidence);
    return {
      ...base,
      status: "CALCULATED",
      points: s(rounded),
      bonusPoints: s(roundedBonus),
      confidence: weakestConfidence(used),
      trace,
    };
  } catch (err) {
    if (err instanceof InsufficientInputsError) {
      trace.notes.push(`INSUFFICIENT EVIDENCE TO VERIFY: missing verified ${err.missingKeys.join(", ")}.`);
      return { ...base, status: "INSUFFICIENT_INPUTS", points: null, bonusPoints: null, confidence: "UNVERIFIED", trace };
    }
    trace.notes.push(`ERROR: ${(err as Error).message}`);
    return { ...base, status: "ERROR", points: null, bonusPoints: null, confidence: "UNVERIFIED", trace };
  }
}
