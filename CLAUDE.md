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
- `src/agent/scorer.ts` — ICP scoring (100-point rubric)
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

### Scoring Rubric (100 points)
| Category | Max Points | What it measures |
|----------|-----------|-----------------|
| Segment & Scale Fit | 20 | Evidence of being in target segment |
| Why Now Triggers | 15 | Fresh signals (hiring, funding, incidents, expansion) |
| Remote Access Pain | 20 | Distributed workforce + internal access complexity |
| Displacement Wedge | 20 | Evidence of legacy VPN or competitor usage |
| Vertical Playbook | 15 | Match to gaming, BYOC, developer-first playbooks |
| Buyer Access & Readiness | 10 | Named targets found with public artifacts |

**Star mapping**: 90–100 = 5★ Extremely High, 75–89 = 4★ High, 60–74 = 3★ Medium, 40–59 = 2★ Low, <40 = 1★ Very Low

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
