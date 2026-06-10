# Scoring Provenance: Sub-Score Breakdowns

## Context

The scorer computes sub-scores internally (Segment 0-20, Remote Pain 0-20, Displacement 0-20, etc.) but discards them — only returning aggregates. `dimensionsToLegacyBreakdown()` (scorer.ts:629) reverse-engineers approximate breakdowns from aggregates using `Math.round(dims.icp_fit * 0.2)`, which is lossy. This phase captures real sub-scores and persists them. Pure deterministic code — zero AI/prompt risk.

## Status

- [x] Step 0: Commit existing uncommitted changes (~3165 lines from prior sessions)
- [ ] Step 1: Add types — `SubScore`, `DimensionBreakdown`
- [ ] Step 2: Refactor `computeIcpFit()` → return `{ score, breakdown }`
- [ ] Step 3: Refactor `computeTiming()` → return `{ score, breakdown }`
- [ ] Step 4: Refactor remaining compute functions (`computeDataConfidence`, `computeReachability`, `computeSignalQuality`)
- [ ] Step 5: Wire breakdowns through `computeAllDimensions()`
- [ ] Step 6: Persist & parse breakdowns (DB column + orchestrator + leads route)
- [ ] Step 7: LeadDetail UI — render sub-score breakdown tree

## Step Details

### Step 0: Commit existing uncommitted changes
Commit ~3165 lines of existing work (LinkedIn extraction, UI overhaul, filters, bulk actions) to establish clean baseline.

### Step 1: Add types
**File**: `packages/server/src/types/index.ts`

```typescript
export interface SubScore {
  label: string;          // "Segment & Scale"
  points: number;         // actual points scored
  max: number;            // max possible
  evidence: string[];     // human-readable evidence strings
}

export interface DimensionBreakdown {
  dimension: string;      // "icp_fit"
  score: number;
  max: number;
  sub_scores: SubScore[];
  penalties?: { points: number; reason: string }[];
}
```

Add optional `breakdowns?: Record<string, DimensionBreakdown>` to `ScoringDimensions`.

### Step 2: Refactor `computeIcpFit()` → `{ score, breakdown }`
**File**: `packages/server/src/agent/scorer.ts` (line 225)

Change return type. Track 5 sub-scores + penalties with evidence strings:
- **Segment & Scale** (0-20): employee confirmed/unconfirmed, engineering evidence, contractor evidence
- **Remote Access Pain** (0-20): BYOC, remote workforce, multi-office, DevEx
- **Displacement Wedge** (0-20): VPN/competitor/legacy match with product names
- **Vertical Match** (0-15): exact/adjacent/tangential, success story
- **Buyer Access** (0-10): champion/security team/IT org
- **Penalties**: disqualifiers matched with severity

Pattern: alongside each `score +=`, push an evidence string describing what triggered it.

### Step 3: Refactor `computeTiming()` → `{ score, breakdown }`
**File**: `packages/server/src/agent/scorer.ts` (line 329)

5 sub-scores:
- **Active Evaluation** (0-30): confirmed vs inferred eval evidence
- **Recent Triggers** (0-25): funding events with amounts/dates
- **Hiring Signals** (0-20): role names, keywords, recency
- **Compound Growth** (0-15): hiring + evaluation + funding combo
- **Recency Modifier** (0-10): recent vs aged signal distribution

### Step 4: Refactor remaining compute functions
**File**: `packages/server/src/agent/scorer.ts`

- **`computeDataConfidence()`** (line 395): Add `breakdown` to return. Sub-scores: source count, field completeness, corroboration, domain validation, signal-to-inference ratio.
- **`computeReachability()`** (line 438): Sub-scores: champions w/ LinkedIn (30), economic buyers (20), other contacts (20), company LinkedIn/website (15), emails (15).
- **`computeSignalQuality()`** (line 523): Per-signal breakdown with weight, confidence multiplier, freshness factor.

### Step 5: Wire through `computeAllDimensions()`
**File**: `packages/server/src/agent/scorer.ts` (line 577)

```typescript
const { score: icp_fit, breakdown: icpBreakdown } = computeIcpFit(fs, icpConfig, scoringSignals);
const { score: timing, breakdown: timingBreakdown } = computeTiming(fs);
// ... etc ...
partialDims.breakdowns = { icp_fit: icpBreakdown, timing: timingBreakdown, ... };
```

Replace `dimensionsToLegacyBreakdown()` call in `scoreCandidateDeterministic()` (line 836) with real breakdowns from `dimensions.breakdowns`.

### Step 6: Persist & parse breakdowns
**Files**: `schema.ts`, `campaignOrchestrator.ts`, `leads.ts`

- Add `scoring_breakdown_v2 TEXT` column to leads (safe ALTER, check existence first)
- In `persistCandidates()` (campaignOrchestrator.ts:606): serialize `score.dimensions.breakdowns` as JSON
- In `parseLead()` (leads.ts): parse `scoring_breakdown_v2` JSON and attach to response
- In re-score endpoint (leads.ts:1062): persist breakdown on UPDATE
- In backfill-composite endpoint: include breakdown if available

### Step 7: LeadDetail UI — render breakdown tree
**File**: `packages/web/src/pages/LeadDetail.tsx`

Replace expandable dimension sections (lines 1090-1200) with breakdown renderer:

```
ICP Fit: 72/100
├── Segment & Scale                 20/20
│   Employee count confirmed (mm), Engineering team evidence
├── Remote Access Pain              14/20
│   Remote workforce confirmed
├── Displacement Wedge              20/20
│   VPN: GlobalProtect (confirmed via job posting)
├── Vertical Match                  12/15
│   Exact match: FinTech
├── Buyer Access                     7/10
│   Champion: VP Eng (has LinkedIn)
└── Penalty                          -1
    Soft disqualifier: government
```

Use existing `expandedSignalCat` state + ChevronDown pattern for expand/collapse.

## Files Modified

| File | Steps | Change |
|------|-------|--------|
| `packages/server/src/types/index.ts` | 1 | Add SubScore, DimensionBreakdown; extend ScoringDimensions |
| `packages/server/src/agent/scorer.ts` | 2-5 | Refactor 5 compute functions, update computeAllDimensions |
| `packages/server/src/db/schema.ts` | 6 | Add scoring_breakdown_v2 column |
| `packages/server/src/agent/campaignOrchestrator.ts` | 6 | Persist breakdowns JSON |
| `packages/server/src/routes/leads.ts` | 6 | Parse breakdowns in parseLead, persist on re-score |
| `packages/web/src/pages/LeadDetail.tsx` | 7 | Render sub-score breakdown tree |

## Reuse

- `dimensionsToLegacyBreakdown()` (scorer.ts:629) — evidence string patterns to copy; function becomes dead code
- `expandedSignalCat` state + ChevronDown in LeadDetail.tsx — reuse for breakdown expand/collapse
- `clamp()` helper (scorer.ts:221)
- `FactConfidence` type already exists

## Backward Compatibility

- `breakdowns` is optional on `ScoringDimensions` — existing leads render as today
- `score_breakdown` column (v1) stays; `scoring_breakdown_v2` is additive
- `dimensionsToLegacyBreakdown()` kept but no longer called for new scores

## Verification

1. `npx tsc --noEmit` in both packages after each step
2. Run a fresh campaign → API returns `scoring_breakdown_v2` with sub-scores
3. LeadDetail renders breakdown tree for scored leads
4. Existing v1 leads render without breakdowns (graceful fallback)
5. Scores identical before/after refactor (same FactSheet → same numbers)

## Future Phases (not in this TODO)

- **Phase 2**: FactSheet source URL pass-through (enrichment adapters → FactSheet → clickable links)
- **Phase 3**: Provenance UI polish (ProvenanceTrail component, enrichment metadata cross-reference)
- **Phase 4**: LinkedIn discovery improvements (editable URL, confidence indicator)
- **Phase 5**: Leads table redesign (column system, header sort, column picker)
