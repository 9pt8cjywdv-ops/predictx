import Decimal from "decimal.js";

/**
 * All engine arithmetic uses decimal.js — never IEEE floats — so that results
 * are reproducible to the cent and identical across reruns and reviewers.
 */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;

export type DecimalLike = string | number | Dec;

export function dec(value: DecimalLike): Dec {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new RangeError(`Non-finite numeric value: ${value}`);
  }
  return new D(value);
}

export type RoundingMethod = "NONE" | "HALF_UP_2DP" | "TRUNCATE_2DP" | "HALF_UP_0DP";

export function applyRounding(value: Dec, method: RoundingMethod): Dec {
  switch (method) {
    case "NONE":
      return value;
    case "HALF_UP_2DP":
      return value.toDecimalPlaces(2, D.ROUND_HALF_UP);
    case "TRUNCATE_2DP":
      return value.toDecimalPlaces(2, D.ROUND_DOWN);
    case "HALF_UP_0DP":
      return value.toDecimalPlaces(0, D.ROUND_HALF_UP);
  }
}

export function minDec(a: Dec, b: Dec): Dec {
  return a.lessThan(b) ? a : b;
}

export function maxDec(a: Dec, b: Dec): Dec {
  return a.greaterThan(b) ? a : b;
}

/** Serialise for traces: fixed string so JSON round-trips without float drift. */
export function s(value: Dec | null | undefined): string | null {
  return value == null ? null : value.toFixed();
}
