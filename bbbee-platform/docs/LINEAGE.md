# Evidence lineage

Spec §7 / §65: every score must trace both chains.

```
SCORE (CalculationResult.points)
  └─ FORMULA (CalculationResult.trace.formula, engineVersion)
       └─ VERIFIED INPUT (CalculationInput: clientClaim | verifiedValue | unverifiedValue | potentialValue)
            └─ EVIDENCE (EvidenceLink → EvidenceItem: originalValue, normalisedValue, sourceLocation{sheet,row,column,page,bbox},
            │            extractionMethod, confidence, reviewStatus, confirmedBy, confirmedAt)
            └─ ORIGINAL DOCUMENT (DocumentVersion: filename, sha256, storageKey — immutable)

SCORE
  └─ CALCULATION RULE (CalculationRule: parameters, weighting, cap, rounding, configurationStatus)
       └─ REGULATORY PROVISION(S) (CalculationRuleProvision → RegulatoryProvision: reference, verbatim text)
            └─ CODE VERSION (RegulatoryVersion: label, validity window, approval) → RegulatoryDocument (Gazette, dates)
```

`traceCalculationResult()` (`src/lib/lineage.ts`) resolves both chains and returns `breaks[]`.
A result is **auditable** only when `breaks` is empty. Breaks include:

* verified input without linked evidence;
* evidence not confirmed by a reviewer;
* evidence or document missing;
* rule `REGULATORY_CONFIGURATION_REQUIRED`;
* rule not linked to any provision;
* regulatory version not in force (not PUBLISHED/SUPERSEDED).

Client claims are never overwritten: `CalculationInput` keeps the claim and the verified value side by side and the
trace records both, so the UI can show *Claimed R600,000 · Verified R410,000 · Outstanding R190,000*.
