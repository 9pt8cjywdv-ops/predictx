import { dec, type DecimalLike } from "./decimal";
import { CONFIGURED, type ConfigurationStatus } from "./types";

export interface RecognitionBand {
  /** Level label as gazetted, e.g. "1". */
  level: string;
  minPoints: string;
  /** Procurement recognition as a fraction (1.35 == 135%). */
  recognitionPercent: string;
}

export interface RecognitionTableConfig {
  regulatoryVersionId: string;
  configurationStatus: ConfigurationStatus | string;
  /** Ordered best level first. */
  bands: RecognitionBand[];
  nonCompliantLabel: string;
  nonCompliantRecognition: string;
}

export interface LevelResult {
  status: "DETERMINED" | "REGULATORY_CONFIGURATION_REQUIRED";
  level: string | null;
  bandIndex: number | null; // index into bands; bands.length == non-compliant
  recognitionPercent: string | null;
}

export function validateRecognitionTable(t: RecognitionTableConfig): string[] {
  const errors: string[] = [];
  if (t.bands.length === 0) errors.push("Recognition table has no bands.");
  for (let i = 1; i < t.bands.length; i++) {
    if (!dec(t.bands[i]!.minPoints).lessThan(dec(t.bands[i - 1]!.minPoints))) {
      errors.push(`Band ${t.bands[i]!.level} minPoints must be strictly below band ${t.bands[i - 1]!.level}.`);
    }
  }
  return errors;
}

export function levelForPoints(table: RecognitionTableConfig, totalPoints: DecimalLike): LevelResult {
  if (table.configurationStatus !== CONFIGURED) {
    return { status: "REGULATORY_CONFIGURATION_REQUIRED", level: null, bandIndex: null, recognitionPercent: null };
  }
  const errors = validateRecognitionTable(table);
  if (errors.length) throw new Error(errors.join(" "));
  const pts = dec(totalPoints);
  const idx = table.bands.findIndex((b) => pts.greaterThanOrEqualTo(dec(b.minPoints)));
  return bandAt(table, idx === -1 ? table.bands.length : idx);
}

export function bandAt(table: RecognitionTableConfig, index: number): LevelResult {
  const i = Math.min(Math.max(index, 0), table.bands.length);
  if (i === table.bands.length) {
    return { status: "DETERMINED", level: table.nonCompliantLabel, bandIndex: i, recognitionPercent: table.nonCompliantRecognition };
  }
  const b = table.bands[i]!;
  return { status: "DETERMINED", level: b.level, bandIndex: i, recognitionPercent: b.recognitionPercent };
}
