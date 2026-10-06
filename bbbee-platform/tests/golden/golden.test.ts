import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { calculateScorecard, type EngineInput, type ScorecardConfig } from "@/lib/engine";

const CaseSchema = z.object({
  id: z.string(),
  description: z.string(),
  provenance: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("ENGINE_FIXTURE") }),
    z.object({
      kind: z.literal("AUTHORITATIVE"),
      establishedBy: z.string().min(1),
      establishedOn: z.string().min(1),
      regulatoryVersionLabel: z.string().min(1),
      sourceReference: z.string().min(1),
    }),
  ]),
  config: z.custom<ScorecardConfig>(),
  inputs: z.array(z.custom<EngineInput>()),
  expected: z.object({
    complete: z.boolean(),
    totalPoints: z.string(),
    indicators: z.record(z.string(), z.string().nullable()),
    bonus: z.record(z.string(), z.string()),
    priority: z.record(z.string(), z.string()),
    levelBeforeDiscount: z.string().nullable(),
    levelAfterDiscount: z.string().nullable(),
  }),
});

const dir = path.join(__dirname, "cases");
const cases = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => CaseSchema.parse(JSON.parse(readFileSync(path.join(dir, f), "utf8"))));

describe("golden verification cases", () => {
  it("has cases to run", () => expect(cases.length).toBeGreaterThan(0));

  it("case ids are unique", () => expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length));

  for (const c of cases) {
    describe(`${c.id} [${c.provenance.kind}]`, () => {
      const out = calculateScorecard(c.config, c.inputs);

      it("matches completeness and total", () => {
        expect(out.complete).toBe(c.expected.complete);
        expect(out.totalPoints).toBe(c.expected.totalPoints);
      });
      it("matches every indicator", () => {
        for (const [code, pts] of Object.entries(c.expected.indicators)) {
          expect(out.indicators.find((i) => i.indicatorCode === code)?.points ?? null, code).toBe(pts);
        }
        for (const [code, b] of Object.entries(c.expected.bonus)) {
          expect(out.indicators.find((i) => i.indicatorCode === code)?.bonusPoints, `${code} bonus`).toBe(b);
        }
      });
      it("matches priority outcomes and levels", () => {
        for (const [el, outcome] of Object.entries(c.expected.priority)) {
          expect(out.priority.find((p) => p.element === el)?.outcome, el).toBe(outcome);
        }
        expect(out.discount?.before.level ?? null).toBe(c.expected.levelBeforeDiscount);
        expect(out.discount?.after.level ?? null).toBe(c.expected.levelAfterDiscount);
      });
    });
  }
});
