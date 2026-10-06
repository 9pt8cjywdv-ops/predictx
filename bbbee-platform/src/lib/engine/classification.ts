import { dec, type DecimalLike } from "./decimal";
import { CONFIGURED, type ConfigurationStatus } from "./types";

export type EntityClass = "EME" | "QSE" | "GENERIC" | "UNDETERMINED";

export interface ClassificationThresholds {
  regulatoryVersionId: string;
  sectorCode: string | null;
  configurationStatus: ConfigurationStatus | string;
  /** Turnover at or below which (if inclusive) an entity is an EME. ZAR. */
  emeMaxTurnover: string;
  /** Turnover at or below which (if inclusive) an entity is a QSE. ZAR. */
  qseMaxTurnover: string;
  upperBoundInclusive: boolean;
  provisionIds: string[];
}

export interface ClassificationResult {
  classification: EntityClass;
  status: "DETERMINED" | "REGULATORY_CONFIGURATION_REQUIRED" | "INSUFFICIENT_EVIDENCE";
  basis: {
    turnover: string | null;
    emeMaxTurnover: string | null;
    qseMaxTurnover: string | null;
    upperBoundInclusive: boolean | null;
    regulatoryVersionId: string;
    provisionIds: string[];
  };
  notes: string[];
}

/**
 * Determine entity size from verified annual total revenue. Thresholds are
 * version-controlled configuration; nothing is hard-coded here.
 */
export function classifyEntity(turnover: DecimalLike | null, t: ClassificationThresholds): ClassificationResult {
  const basis = {
    turnover: turnover == null ? null : dec(turnover).toFixed(),
    emeMaxTurnover: t.configurationStatus === CONFIGURED ? t.emeMaxTurnover : null,
    qseMaxTurnover: t.configurationStatus === CONFIGURED ? t.qseMaxTurnover : null,
    upperBoundInclusive: t.configurationStatus === CONFIGURED ? t.upperBoundInclusive : null,
    regulatoryVersionId: t.regulatoryVersionId,
    provisionIds: t.provisionIds,
  };
  if (t.configurationStatus !== CONFIGURED) {
    return { classification: "UNDETERMINED", status: "REGULATORY_CONFIGURATION_REQUIRED", basis, notes: ["Turnover thresholds not configured from an approved source."] };
  }
  if (turnover == null) {
    return { classification: "UNDETERMINED", status: "INSUFFICIENT_EVIDENCE", basis, notes: ["INSUFFICIENT EVIDENCE TO VERIFY: verified turnover not available."] };
  }
  const tv = dec(turnover);
  if (tv.isNegative()) throw new RangeError("Turnover cannot be negative");
  const eme = dec(t.emeMaxTurnover);
  const qse = dec(t.qseMaxTurnover);
  if (!eme.lessThan(qse)) throw new Error("EME threshold must be below QSE threshold");
  const within = (max: typeof eme) => (t.upperBoundInclusive ? tv.lessThanOrEqualTo(max) : tv.lessThan(max));
  const classification: EntityClass = within(eme) ? "EME" : within(qse) ? "QSE" : "GENERIC";
  return { classification, status: "DETERMINED", basis, notes: [] };
}
