# SignalStack

## What This Is
SignalStack detects buying signals — VPN usage, hiring patterns, tech stack, funding events — and stacks them through a progressive AI funnel to build composite propensity scores. It researches, qualifies, enriches, scores, and briefs prospect companies against an Ideal Customer Profile (ICP), spending the least tokens on the widest pool and the most on top candidates. Built for Twingate's GTM team. Monorepo: Express+SQLite backend, React+Vite frontend.

## Architecture

```
packages/
  server/   Express API (port 3001), SQLite via better-sqlite3, Vertex AI SDK
  web/      React 18 + Tailwind + Recharts (port 5173)
```

### Server Key Paths
- `src/agent/campaignOrchestrator.ts` — **Main pipeline engine.** Runs the progressive funnel.
- `src/agent/prompts/` — All Claude prompt templates (campaign.ts, research.ts, scoring.ts, brief.ts)
- `src/agent/scorer.ts` — Deterministic rules engine (v2) + legacy AI scoring (v1)
- `src/agent/briefWriter.ts` — Outreach brief generation
- `src/agent/tokenTracker.ts` — Token/cost tracking, MultiModelTokenTracker for funnel
- `src/agent/runRegistry.ts` — In-memory AbortController registry for run cancellation
- `src/agent/activityLogger.ts` — Structured logging for pipeline activity (phases, findings, thinking)
- `src/agent/enrichment/` — Data source enrichment modules (website, GitHub, DNS, jobs, etc.)
- `src/routes/` — REST API (campaigns, leads, runs, analytics, icp, exclusions, events SSE)
- `src/db/schema.ts` — SQLite schema with safe ALTER migrations
- `src/events/eventBus.ts` — In-process event bus for SSE streaming
- `src/types/index.ts` — All shared TypeScript types

### Web Key Paths
- `src/pages/CampaignDetail.tsx` — Campaign view + settings tabs (Pipeline, Schedule, Exclusions, Feed)
- `src/pages/Dashboard.tsx` — Overview analytics + active run indicators
- `src/components/FunnelConfigurator.tsx` — **Single pane of glass** for all pipeline config (models, prompts, sources, limits)
- `src/components/ActivityPanel.tsx` — Real-time pipeline activity feed
- `src/hooks/useEventStream.ts` — SSE subscription hook
- `src/hooks/useRunActivity.ts` — Pipeline run activity state management

## Progressive Funnel Pipeline

The core pipeline is a **progressive funnel** — spend the least tokens on the most candidates, the most tokens on the fewest:

1. **Discover** (Haiku, cheap) → Cast wide net, find ~50 candidates. Model + prompt guidance configurable.
2. **Qualify** (no LLM, free) → Rules-based filtering on must-have/disqualifying keywords + anti-patterns.
3. **Enrich** (no LLM) → External data sources configurable per-campaign (website, GitHub, DNS, jobs, news).
4. **Score** (Sonnet, mid-tier) → ICP fit scoring with 100-point rubric. Model + scoring guidance configurable.
5. **Brief** (Opus, expensive) → Deep outreach briefs for top candidates. Model + outreach tone + brief guidance configurable.

Each step is independently configurable per campaign via `funnel_config`:
- Model selection, max tokens, candidate limits, prompt_instructions (with append/override mode)
- Qualify step: qualification/disqualification criteria (keyword matching)
- Enrich step: per-source enable/disable (source_overrides)
- Brief step: outreach_tone selector (consultative/direct/technical/executive/casual)
- When `funnel_config` is null, `buildLegacyFunnel()` creates a backward-compatible config

### Config Consolidation
All pipeline behavior is configured through the **Funnel** (FunnelConfigurator component). Legacy tabs (Pipeline, Prompts, Sources) have been removed — their settings now live inside the relevant funnel step:
- Research preamble → Discover step's "Research guidance" (with inherit/append/override from org defaults)
- Outreach tone → Brief step's tone selector
- Data source toggles → Enrich step's source overrides
- `pipeline_overrides`, `prompt_overrides`, `source_overrides` DB columns still exist but are no longer written to by the UI. The orchestrator falls back to them for backward compatibility.

## Key Patterns

- **Vertex AI SDK**: Model IDs — `claude-sonnet-4-6`, `claude-opus-4-6` (4.6+ use dateless IDs), `claude-haiku-4-5@20251001` (older models use `@date`)
- **SSE Events**: Real-time progress via EventBus → `campaign.started`, `campaign.progress`, `campaign.completed`, `campaign.failed`, `campaign.cancelled`
- **Run Cancellation**: AbortController in runRegistry.ts, signal checked between steps + wired to stream.abort() mid-flight
- **Token Tracking**: MultiModelTokenTracker aggregates costs across models; child trackers fire parent callbacks
- **DB Migrations**: Safe ALTER pattern — check column existence before adding. Never drop/recreate tables.
- **Auth**: JWT + bcrypt, roles: superadmin > admin > operator > member > viewer
- **Vertex AI SDK**: Uses `@anthropic-ai/vertex-sdk` directly (not Claude Code CLI). Auth via gcloud ADC or `GOOGLE_APPLICATION_CREDENTIALS`.

## Commands

```bash
npm install              # Install all workspaces
npm run dev              # Start both server (:3001) and web (:5173) via concurrently
npm run build            # Production build (tsc + vite)
npm start                # Run production server
```

No test suite or linter configured yet.

**Required env vars** (see `.env.example`):
- `CLOUD_ML_REGION` — Vertex AI region (e.g. `us-east5`)
- `ANTHROPIC_VERTEX_PROJECT_ID` — GCP project ID
- `JWT_SECRET` — for auth tokens

Default credentials (auto-created on first run): `admin@example.com` / `admin123` — **change immediately**

## Twingate ICP — Domain Context

This app generates leads for **Twingate**, a modern Zero Trust Network Access (ZTNA) solution that replaces legacy VPNs. All campaigns, scoring, and outreach are built around this ICP.

### Segment Definitions (by estimated VPN users)
- **SMB**: 100–350 VPN users (~30–350 employees)
- **MM (Mid-Market)**: 350–650 VPN users (~351–650 employees)
- **ENT (Enterprise)**: 650–15,000 VPN users (~651–15,000 employees)

### Priority Verticals
1. **Gaming** — Studios/publishers with Perforce, dev kits, render farms, large asset workflows, latency-sensitive builds (Epic Games, Riot Games, 2K Games)
2. **BYOC / Builder Platforms** — Customer-managed deployments, private networking, data security vendors (Cyera, Tensor9, InterSystems, Twilio-like patterns)
3. **Developer-First / Cloud-Native SaaS** — Platform engineering, multi-cloud, IaC-heavy (Snyk, HashiCorp, Confluent)
4. **Regulated Industries** — FinTech (PCI-DSS, SOX), HealthTech (HIPAA), companies with strong compliance drivers

### Tech Signals
- **VPN products to replace**: Cisco AnyConnect, Palo Alto GlobalProtect, Fortinet FortiClient, Ivanti/Pulse Secure, SSL VPN, IPSec VPN
- **Competitors to displace**: Tailscale, Netbird, Zscaler, Cloudflare Access, OpenVPN, CloudConnexa
- **Platform initiatives**: Kubernetes, ZTNA, PAM, device posture, least privilege, IaC, platform engineering
- **Adjacent products**: MDM (Jamf, Intune), EDR (CrowdStrike, SentinelOne), IdP (Okta, Entra), SIEM (Splunk, Datadog)
- **Conference signals**: KubeCon, GDC, RSA, AWS re:Invent, Black Hat

### Scoring Architecture — Deterministic vs AI

The scoring system uses a **3-layer architecture** where AI handles qualitative extraction and narrative, but all numbers come from deterministic code:

```
Layer 1: AI Fact Extraction (Sonnet)
  Input:  enrichment data, signals, notes, key_people
  Output: structured FactSheet (industry, VPN products, hiring signals, etc.)
  Role:   Extract and classify facts — NO number assignment

Layer 2: Deterministic Rules Engine (code)
  Input:  FactSheet + ICP config + enrichment metadata
  Output: all dimension scores
  Role:   Apply configurable scoring rules — 100% reproducible

Layer 3: AI Narrative Generation (Opus)
  Input:  FactSheet + dimension scores + enrichment data
  Output: briefs, pain hypotheses, outreach messages
  Role:   Write the story — constrained by the rules engine's numbers
```

**Key invariant**: Same enrichment data + same ICP config = same scores, every run. AI is used for qualitative analysis (fact extraction, narrative writing) but never assigns point values.

### Scoring Dimensions (v2 — Deterministic)

| Dimension | Range | Bucket | What it measures |
|-----------|-------|--------|-----------------|
| ICP Fit | 0-100 | Fit | Segment, remote pain, displacement wedge, vertical, buyer access |
| Reachability | 0-100 | Fit | Named contacts, LinkedIn URLs, org visibility |
| Timing | 0-100 | Intent | Active evaluation, recent triggers, hiring signals, compound growth |
| Signal Quality | 0-100 | Intent | Weighted buying-intent strength × confidence × freshness |
| Data Confidence | A-F (0-100) | Evidence | Source count, field completeness, corroboration |
| Research Completeness | 0-100% | Evidence | Sources checked vs available |
| Signal Density | Count | Evidence | Categorized signal counts with freshness decay |

### Composite Formula

```
Fit (Potential)  = icp_fit × 0.70 + reachability × 0.20 + data_confidence × 0.10
Intent (Urgency) = timing × 0.60 + signal_quality × 0.40
Evidence Modifier = 0.5 + (research_completeness / 200)

fit_score = round((Fit × 55% + Intent × 45%) × Evidence Modifier)
```

Weights configurable per-campaign via `composite_weights` in funnel config. Watch candidate auto-detection: `Fit >= 60 AND Intent < 35`.

### Legacy Scoring (v1)

v1 leads use AI-scored 100-point rubric (6 categories: Segment & Scale 20pts, Why Now 15pts, Remote Access Pain 20pts, Displacement 20pts, Vertical 15pts, Buyer Access 10pts). Still supported for backward compatibility but no longer the default.

**Star mapping**: 90–100 = 5★, 75–89 = 4★, 60–74 = 3★, 40–59 = 2★, <40 = 1★

### Watch List

Leads with high Fit but low Intent (the "great fit, bad timing" pattern) can be added to a **watch list** with a snooze date. When the snooze expires, the system automatically re-enriches and re-scores the lead, then surfaces it with a delta comparison showing what changed since the snooze.

- **Categories**: `timing_watch` (waiting for buying signals), `data_needs` (insufficient enrichment data), `nurture` (long-term monitoring), `manual`
- **Action Card**: Top of LeadDetail sidebar — tells salespeople what to do: Engage / Watch / Research / Pass
- **Watch List page**: Timeline view grouped by wake date (waking today, this week, watching)
- **Scheduler**: Daily cron via `watchlistScheduler.ts`, piggybacks on existing `node-cron` infra

### Persona Pyramid (for outreach briefs)
1. **Champion** (REQUIRED) — Director/Sr. Manager/Team Lead (IT, Security, Platform). Feels VPN pain daily, drives evaluations.
2. **Economic Buyer** (REQUIRED for ENT/MM) — VP/CISO. Signs the purchase order. Target with ROI/risk angles.
3. **Executive Sponsor** (OPTIONAL) — CTO/CIO. Only include with specific signal (conference talk, tweet about zero trust).

**Anti-pattern**: Do NOT fill all slots with C-suite. Ideal card: 1 Director champion + 1 VP economic buyer.

### Twingate Value Props
- Zero-trust architecture, per-resource access controls
- No network reconfiguration, 10-minute deployment
- IaC-first (Terraform, Pulumi)
- Gaming: low-latency for Perforce, dev kits, large assets
- BYOC: private tunnels to customer-managed environments
- IT: fewer tickets, faster onboarding, complete audit trails
- Security: least-privilege, device posture, no exposed network

## Conventions

- TypeScript strict mode in both packages
- Config UIs should have real depth: dropdowns, visual pickers, colored labels — not just text inputs
- Activity logs should show Claude's reasoning within steps, not just completion markers
- Run comprehensive audits before transitioning between major phases of work
- Prefer editing existing files over creating new ones
