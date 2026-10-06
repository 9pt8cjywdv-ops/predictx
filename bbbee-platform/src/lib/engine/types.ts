import type { RoundingMethod } from "./decimal";

export const ENGINE_VERSION = "1.0.0";

/** Marker used everywhere a regulatory value has not been sourced from an authoritative document. */
export const REGULATORY_CONFIGURATION_REQUIRED = "REGULATORY_CONFIGURATION_REQUIRED" as const;
export const CONFIGURED = "CONFIGURED" as const;
export type ConfigurationStatus = typeof REGULATORY_CONFIGURATION_REQUIRED | typeof CONFIGURED;

export type Confidence = "HIGH" | "MEDIUM" | "LOW" | "UNVERIFIED";

export type FormulaType = "PROPORTIONAL" | "BINARY_THRESHOLD" | "BANDED" | "CUSTOM_HANDLER";

export type CalculationStatus =
  | "CALCULATED"
  | "REGULATORY_CONFIGURATION_REQUIRED"
  | "INSUFFICIENT_INPUTS"
  | "ERROR";

/**
 * A verified, structured input supplied to the engine. Only `verifiedValue` is
 * ever used for scoring; the client claim travels alongside for display.
 */
export interface EngineInput {
  key: string;
  unit: "ZAR" | "PERCENT" | "COUNT" | "BOOLEAN" | "RATIO";
  verifiedValue: string | null;
  clientClaim?: string | null;
  confidence: Confidence;
  /** Ids of CalculationInput / EvidenceItem rows — the lineage chain. */
  calculationInputId?: string;
  evidenceIds: string[];
}

export type BonusRule =
  | { type: "THRESHOLD_FLAT"; inputKey: string; threshold: string; comparator: Comparator; points: string }
  | { type: "NONE" };

export type Comparator = "GTE" | "GT" | "LTE" | "LT" | "EQ";

export interface ProportionalParams {
  numeratorKey: string;
  /** If omitted, numerator is compared directly to target. */
  denominatorKey?: string;
  /** Target expressed in the same terms as actual (fraction when a denominator is used). */
  target: string;
}

export interface BinaryThresholdParams {
  inputKey: string;
  threshold: string;
  comparator: Comparator;
}

export interface BandedParams {
  inputKey: string;
  /** Bands evaluated in order; first match wins. `max` is exclusive unless `maxInclusive`. */
  bands: Array<{ min: string; max?: string; maxInclusive?: boolean; points: string }>;
}

export interface CustomHandlerParams {
  handler: string;
  [k: string]: unknown;
}

/** One indicator rule, tied to an explicit regulatory version. */
export interface RuleConfig {
  ruleId: string;
  regulatoryVersionId: string;
  indicatorCode: string;
  element: string;
  formulaType: FormulaType;
  parameters: ProportionalParams | BinaryThresholdParams | BandedParams | CustomHandlerParams | Record<string, unknown>;
  weighting: string | null;
  cap: string | null;
  bonusRule: BonusRule | null;
  roundingMethod: RoundingMethod;
  configurationStatus: ConfigurationStatus | string;
  provisionIds: string[];
}

export interface CalculationTrace {
  engineVersion: string;
  ruleId: string;
  regulatoryVersionId: string;
  indicatorCode: string;
  formulaType: FormulaType;
  formula: string;
  inputs: Array<Pick<EngineInput, "key" | "unit" | "verifiedValue" | "clientClaim" | "confidence" | "evidenceIds" | "calculationInputId">>;
  target: string | null;
  actual: string | null;
  recognisedAmount: string | null;
  achievementRatio: string | null;
  weighting: string | null;
  rawPoints: string | null;
  cappedPoints: string | null;
  bonusPoints: string | null;
  roundingMethod: RoundingMethod;
  result: string | null;
  provisionIds: string[];
  notes: string[];
}

export interface IndicatorResult {
  indicatorCode: string;
  element: string;
  status: CalculationStatus;
  points: string | null;
  bonusPoints: string | null;
  confidence: Confidence;
  trace: CalculationTrace;
}

export class EngineConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineConfigurationError";
  }
}
