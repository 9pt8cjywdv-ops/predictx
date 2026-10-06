import { dec, type Dec } from "../decimal";
import type { EngineInput } from "../types";
import { InsufficientInputsError } from "./types";

/** Read a verified value or throw — the engine never substitutes client claims. */
export function requireVerified(inputs: Map<string, EngineInput>, keys: string[]): Dec[] {
  const missing = keys.filter((k) => {
    const v = inputs.get(k)?.verifiedValue;
    return v === null || v === undefined || v === "";
  });
  if (missing.length) throw new InsufficientInputsError(missing);
  return keys.map((k) => dec(inputs.get(k)!.verifiedValue!));
}
