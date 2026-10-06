import type { Confidence } from "./types";

const ORDER: Confidence[] = ["UNVERIFIED", "LOW", "MEDIUM", "HIGH"];

/** A result is only as reliable as its weakest input. */
export function weakestConfidence(values: Confidence[]): Confidence {
  if (values.length === 0) return "UNVERIFIED";
  return values.reduce((acc, c) => (ORDER.indexOf(c) < ORDER.indexOf(acc) ? c : acc), "HIGH" as Confidence);
}

export function isLowConfidence(c: Confidence): boolean {
  return c === "LOW" || c === "UNVERIFIED";
}
