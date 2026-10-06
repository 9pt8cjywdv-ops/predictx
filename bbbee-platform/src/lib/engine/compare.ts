import type { Dec } from "./decimal";
import type { Comparator } from "./types";

export function compare(value: Dec, comparator: Comparator, threshold: Dec): boolean {
  switch (comparator) {
    case "GTE":
      return value.greaterThanOrEqualTo(threshold);
    case "GT":
      return value.greaterThan(threshold);
    case "LTE":
      return value.lessThanOrEqualTo(threshold);
    case "LT":
      return value.lessThan(threshold);
    case "EQ":
      return value.equals(threshold);
  }
}

export const COMPARATOR_SYMBOL: Record<Comparator, string> = { GTE: "≥", GT: ">", LTE: "≤", LT: "<", EQ: "=" };
