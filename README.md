# SignalStack — AI-Powered Prospect Intelligence

**Stack signals from 14+ sources. Qualify leads with AI. Arm your reps with intelligence briefs.**

SignalStack is the intelligence layer that sits before your outreach stack. It answers the two hardest questions in B2B sales: **"Who should we talk to?"** and **"What should we say?"**

---

## The Problem

Sales teams waste 60%+ of their time on manual research, enriching leads from scattered tools, and trying to figure out which accounts to prioritize. Meanwhile:

- **Static lead databases** are stale the moment you buy them
- **Single-source enrichment** gives you fragments, not the full picture
- **Inbound leads** from events and partners sit in spreadsheets, unqualified
- **Outbound and inbound** are separate workflows with no signal convergence

## The SignalStack Approach

SignalStack takes a fundamentally different approach: **stack multiple real-time signals, let AI reason over them, and output intelligence briefs that reps can act on immediately.**

1. **AI-Driven Research** — Claude researches companies in real time, evaluating signals across the web
2. **14+ Enrichment Sources** — 5 free built-in sources run automatically; 9 API-connected sources for deeper data
3. **Signal Convergence** — When inbound leads match outbound campaign patterns, they're flagged as highest priority
4. **Intelligence Briefs** — Not just scores — full briefs with pain hypotheses, competitive displacement strategies, buyer personas, and personalized outreach angles
5. **Export to Your Outreach Stack** — SignalStack does the thinking; your outreach tool (Outreach.io, Salesloft, HubSpot, Apollo) does the sending

### Why This Matters

| Without SignalStack | With SignalStack |
|---|---|
| Rep spends 2 hours researching one account | AI researches, enriches, and scores in minutes |
| Single data source, incomplete picture | 14+ sources stacked for full-spectrum intelligence |
| Inbound leads sit unqualified for days | Auto-enriched, scored, and qualified on import |
| No connection between inbound interest and outbound targeting | Signal convergence flags high-priority overlaps |
| Generic outreach, low reply rates | Personalized pain hypotheses and talking points per persona |

---

## Architecture

```
                           ┌─────────────────────────────────────────┐
                           │            LEAD SOURCES                  │
                           ├──────────┬──────────┬──────────┬────────┤
                           │ Outbound │ Campaign │ Inbound  │Webhook │
                           │ Research │ Research │ CSV/Form │  API   │
                           └────┬─────┴────┬─────┴────┬─────┴───┬────┘
                                │          │          │         │
                                ▼          ▼          ▼         ▼
                        ┌───────────────────────────────────────────┐
                        │           ENRICHMENT LAYER                 │
                        │                                            │
                        │  FREE (always-on)    │  PAID (API keys)    │
                        │  ─────────────────   │  ────────────────   │
                        │  Website Analysis    │  Brave Web Search   │
                        │  GitHub Presence     │  Crunchbase          │
                        │  Job Postings        │  Apollo.io           │
                        │  DNS Fingerprint     │  Salesforce CRM      │
                        │  Wikipedia/Wikidata  │  Clearbit, 6sense    │
                        │                      │  Hunter, BuiltWith   │
                        │                      │  LinkedIn Sales Nav  │
                        └──────────────┬────────────────────────────┘
                                       │
                                       ▼
                        ┌──────────────────────────────────────┐
                        │         SCORING ENGINE                │
                        │                                       │
                        │  Claude AI evaluates each candidate   │
                        │  against your ICP configuration:      │
                        │                                       │
                        │  • Segment/Scale Fit (ENT/MM/SMB)     │
                        │  • Why-Now Triggers                   │
                        │  • Pain Indicators                    │
                        │  • Displacement Wedge                 │
                        │  • Vertical Playbook Match            │
                        │  • Buyer Access Readiness             │
                        │  • Feedback-Based Adjustments         │
                        │                                       │
                        │  Output: 0-100 fit score + breakdown  │
                        └──────────────┬───────────────────────┘
                                       │
                                       ▼
                        ┌──────────────────────────────────────┐
                        │         BRIEF GENERATION              │
                        │                                       │
                        │  For each qualified lead, generates:  │
                        │                                       │
                        │  • Executive brief (markdown)         │
                        │  • Pain hypotheses with evidence      │
                        │  • Tech stack intelligence            │
                        │  • Competitive displacement strategy  │
                        │  • 3 buyer personas with outreach     │
                        │    angles and talking points           │
                        │  • Source citations                   │
                        └──────────────┬───────────────────────┘
                                       │
                                       ▼
                        ┌──────────────────────────────────────┐
                        │         SIGNAL CONVERGENCE            │
                        │                                       │
                        │  Inbound leads are cross-referenced   │
                        │  against active outbound campaigns.   │
                        │  Domain + pattern keyword matching    │
                        │  surfaces high-priority overlaps.     │
                        └──────────────┬───────────────────────┘
                                       │
                                       ▼
                ┌───────────────────────┴───────────────────────┐
                │                                               │
                ▼                                               ▼
   ┌────────────────────────┐              ┌────────────────────────┐
   │  SIGNALSTACK DASHBOARD │              │  EXPORT TO OUTREACH    │
   │                        │              │                        │
   │  Lead cards + briefs   │              │  Salesforce CSV        │
   │  Campaign management   │              │  Outreach.io / Salesloft│
   │  Inbound import        │              │  HubSpot / Apollo      │
   │  Source configuration  │              │  Markdown briefs       │
   │  ICP customization     │              │  RSS feed              │
   │  Feedback loop         │              │  Webhook (any CRM)     │
   └────────────────────────┘              └────────────────────────┘
```

---

## How It Works

### 1. Configure Your ICP

Tell SignalStack who your ideal customer is:
- **Company context** — your product, value props, differentiators
- **Segments** — Enterprise, Mid-Market, SMB thresholds
- **Verticals** — target industries
- **Tech signals** — technologies that indicate fit
- **Competitors** — products to displace
- **Signal weights** — customize how each signal impacts scoring
- **Buyer personas** — target roles and departments

### 2. Research Campaigns (Outbound)

Create campaigns with a **pattern thesis** — a hypothesis about which types of companies need your product:

- *"Companies with 500+ employees migrating from Cisco AnyConnect to ZTNA"*
- *"Series B+ dev tool companies building self-hosted/BYOC deployment"*
- *"Healthcare orgs with HIPAA compliance needs evaluating zero trust"*

Click **Run** and SignalStack autonomously:
1. Researches companies matching the pattern (Claude AI)
2. Enriches each with data from all enabled sources
3. Scores against your ICP
4. Generates intelligence briefs with personas and outreach angles

### 3. Inbound Qualification

Sales teams collect leads from conferences, webinars, partners, and forms. Import them and let SignalStack qualify:

- **CSV Upload** — Drag-and-drop from any spreadsheet
- **Quick Add** — Manually enter a single company
- **Webhook** — Receive from Zapier, HubSpot, Salesforce, or event platforms

Every inbound lead is automatically enriched, scored, qualified, and cross-referenced against active campaigns.

### 4. Signal Convergence

The magic happens when inbound and outbound overlap. When a company you imported from a conference **also matches** an active research campaign's patterns, SignalStack flags it with a convergence score. These are your **highest-propensity leads** — both targeted by your team AND showing inbound interest.

### 5. Export to Your Outreach Stack

SignalStack is the intelligence engine, not the outreach tool. Export qualified leads with full briefs to:
- **Salesforce** — Summary CSV or detailed CSV with custom fields
- **Outreach.io / Salesloft** — Import contacts with personalized messaging
- **HubSpot / Apollo** — Push enriched leads into sequences
- **Markdown briefs** — Share intelligence with your team
- **RSS feed** — Subscribe to weekly intelligence updates

---

## Enrichment Sources

### Built-in (Free, always-on)

| Source | What It Detects |
|--------|----------------|
| **Website Analysis** | Deployment models (self-hosted, cloud, hybrid), pricing tiers, product keywords |
| **GitHub Presence** | Repos, stars, languages, open-source presence, tech stack indicators |
| **Job Postings** | Hiring signals, tech stack from job descriptions, growth indicators |
| **DNS Fingerprint** | Email provider (Google/Microsoft), SaaS tools from DNS records, HTTP tech headers |
| **Wikipedia/Wikidata** | Employee count, founding year, HQ location, industry classification |

### API-Connected (Optional)

| Source | Category | What It Adds |
|--------|----------|-------------|
| Brave Search | Research | Real-time news, funding announcements, tech stack mentions |
| Crunchbase | Company Data | Funding rounds, investors, acquisitions, growth metrics |
| Apollo.io | People | Decision-makers with verified emails and titles |
| Clearbit | Company Data | Tech stack detection, firmographics |
| Salesforce | CRM | Existing accounts, open opportunities (prevent duplicates) |
| 6sense | Intent | Anonymous buying intent signals by topic |
| LinkedIn | People | Org charts, company insights |
| Hunter.io | People | Email finder and verifier |
| BuiltWith | Technographics | Detailed technology profiling |

---

## Scoring & Intelligence

Each lead receives a **0-100 fit score** with a transparent breakdown:
- Segment/scale fit
- Why-now triggers
- Pain indicators
- Competitive displacement opportunity
- Vertical playbook match
- Buyer access readiness
- Feedback-based adjustments (learns from your thumbs up/down)

Plus a full **intelligence brief** with:
- Pain hypotheses backed by evidence
- Tech stack analysis
- Competitive displacement strategy
- 3 buyer personas (Champion, Economic Buyer, Executive Sponsor) with personalized outreach angles
- Source citations for every claim

---

## Integration Layer

SignalStack is designed to be a **node in your pipeline**, not a standalone tool. It exposes a full integration layer for connecting to upstream and downstream systems.

### Event System

Every significant action emits a typed event through an internal event bus:

| Event | Trigger |
|-------|---------|
| `lead.created` | New lead from any source |
| `lead.enriched` | Enrichment complete |
| `lead.scored` | ICP scoring complete |
| `lead.qualified` | Lead passes qualification threshold |
| `lead.disqualified` | Lead fails qualification |
| `lead.status_changed` | Lifecycle status updated |
| `campaign.started` | Campaign research begins |
| `campaign.completed` | Campaign results ready |
| `import.completed` | Inbound import processed |
| `convergence.detected` | Inbound/outbound signal overlap |

### Outbound Webhooks

Register webhook subscriptions to push events to external systems in real-time:

```bash
# Create a webhook subscription
curl -X POST http://localhost:3001/api/webhooks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-app.com/webhooks/signalstack",
    "events": ["lead.qualified", "campaign.completed"],
    "secret": true
  }'
```

Features:
- **HMAC-SHA256 signing** — Payloads signed with `X-SignalStack-Signature` header
- **Automatic retries** — 3 attempts with exponential backoff (30s, 5min, 30min)
- **Delivery log** — Full audit trail of every webhook delivery
- **Pattern matching** — Subscribe to `lead.*` or `*` for wildcard matching

### Real-Time Event Stream (SSE)

Stream events in real-time using Server-Sent Events:

```bash
curl -N -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/api/events/stream?types=lead.qualified,campaign.completed"
```

### REST API

Full REST API with versioning (`/api/v1/`), rate limiting, and an OpenAPI spec:

```bash
# OpenAPI spec
curl http://localhost:3001/api/docs/openapi.json

# Ingest leads via webhook
curl -X POST http://localhost:3001/api/inbound/webhook \
  -H "x-api-key: YOUR_API_KEY" \
  -d '[{"company_name": "Acme Corp", "domain": "acme.com"}]'

# Get qualified leads
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/api/leads?lead_status=qualified&sort=fit_score&order=desc"
```

**Rate Limits:** 100 req/min (standard), 20 req/min (webhook), 5 req/min (heavy operations)

### Pipeline Integration Examples

```
Zapier/n8n/Make  ──→  Inbound Webhook  ──→  SignalStack  ──→  Outbound Webhook  ──→  Outreach.io
HubSpot Form    ──→  Inbound Webhook  ──→  Enrich+Score ──→  SSE Stream        ──→  Dashboard
Salesforce      ──→  CSV Export       ──→  Import        ──→  Webhook           ──→  Slack Alert
Conference App  ──→  CSV Upload       ──→  Qualify       ──→  Webhook           ──→  CRM Update
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| AI Engine | Anthropic Claude (configurable model) |
| Backend | Node.js, Express, TypeScript |
| Database | SQLite (better-sqlite3, WAL mode) |
| Frontend | React, TypeScript, Tailwind CSS, Vite |
| Auth | JWT with bcrypt password hashing |
| Integration | Event bus, outbound webhooks, SSE, OpenAPI |

## Project Structure

```
packages/
├── server/
│   ├── src/
│   │   ├── agent/                    # AI pipeline
│   │   │   ├── researcher.ts         # Company research (Claude)
│   │   │   ├── scorer.ts             # ICP scoring (Claude)
│   │   │   ├── briefWriter.ts        # Brief generation (Claude)
│   │   │   ├── orchestrator.ts       # Outbound pipeline orchestrator
│   │   │   ├── campaignOrchestrator.ts  # Campaign research pipeline
│   │   │   ├── inboundOrchestrator.ts   # Inbound qualification pipeline
│   │   │   ├── convergenceChecker.ts    # Signal convergence detection
│   │   │   ├── tokenTracker.ts       # Token usage & cost tracking
│   │   │   └── enrichment/           # Data source enrichment
│   │   │       ├── service.ts        # Enrichment orchestrator
│   │   │       ├── types.ts          # Source types & configs
│   │   │       └── adapters/         # 14 source adapters
│   │   ├── events/                   # Integration layer
│   │   │   ├── eventBus.ts          # Typed event bus (EventEmitter)
│   │   │   └── webhookDispatcher.ts # Outbound webhook delivery + retry
│   │   ├── middleware/               # API middleware
│   │   │   ├── apiVersion.ts        # Version header (v1)
│   │   │   └── rateLimit.ts         # Sliding window rate limiter
│   │   ├── routes/                   # API endpoints
│   │   │   ├── leads.ts             # Lead CRUD + filters
│   │   │   ├── campaigns.ts         # Research campaign management
│   │   │   ├── inbound.ts           # CSV/manual/webhook import
│   │   │   ├── webhooks.ts          # Outbound webhook subscriptions
│   │   │   ├── events.ts            # SSE real-time stream
│   │   │   ├── dataSources.ts       # Enrichment source config
│   │   │   ├── icp.ts              # ICP configuration
│   │   │   ├── exclusions.ts       # Company exclusions
│   │   │   └── exports.ts          # Export to outreach tools
│   │   ├── db/schema.ts            # SQLite schema + migrations
│   │   ├── openapi.ts              # OpenAPI 3.0 specification
│   │   └── types/index.ts          # TypeScript interfaces
│   └── package.json
└── web/
    ├── src/
    │   ├── pages/
    │   │   ├── Dashboard.tsx        # Prospect intelligence overview
    │   │   ├── LeadDetail.tsx       # Full lead brief + personas
    │   │   ├── Campaigns.tsx        # Research campaign list
    │   │   ├── CampaignDetail.tsx   # Campaign leads + definition
    │   │   ├── CampaignCreate.tsx   # Campaign builder
    │   │   ├── Inbound.tsx          # CSV upload, quick add, webhook
    │   │   ├── Integrations.tsx     # Webhooks, SSE, API reference
    │   │   ├── ICPSettings.tsx      # ICP, pipeline, prompts, sources
    │   │   ├── Exclusions.tsx       # Manage exclusions
    │   │   ├── ExportPage.tsx       # Export to outreach stack
    │   │   └── RunHistory.tsx       # Research run logs + costs
    │   ├── components/
    │   │   ├── Layout.tsx           # Sidebar navigation
    │   │   ├── LeadCard.tsx         # Lead summary card with badges
    │   │   └── ScoreBadge.tsx       # Score/segment/confidence badges
    │   └── api/client.ts           # API client with auth
    └── package.json
```

## Getting Started

### Prerequisites
- Node.js 18+
- An Anthropic API key

### Setup

```bash
# Install dependencies
npm install

# Set environment variables
cp packages/server/.env.example packages/server/.env
# Edit .env with your ANTHROPIC_API_KEY

# Start the API server (port 3001)
npm run dev -w packages/server

# Start the frontend (port 5173) — in a separate terminal
npm run dev -w packages/web
```

### First Run

1. Register an admin account at `/login`
2. Go to **Settings** to configure your ICP (company context, segments, verticals, competitors)
3. Check **Data Sources** — 5 free sources are enabled by default
4. Create a **Campaign** with your research thesis
5. Hit **Run Now** and wait for results
6. Try **Inbound** — upload a CSV of conference leads to qualify them
7. **Export** qualified leads to your outreach tool

---

## Positioning: Intelligence Layer, Not Outreach Tool

SignalStack is intentionally focused on the **intelligence side** of the sales pipeline. Here's why:

**Outreach execution is a solved problem.** Tools like Outreach.io, Salesloft, Apollo, and HubSpot Sequences are excellent at sending emails, managing cadences, and tracking engagement. There's no need to rebuild that.

**Intelligence is the bottleneck.** What those tools can't do is tell your reps *which* accounts to target, *why* those accounts are a fit right now, and *what* to say that's specific to each prospect's pain points. That's the hard problem — and that's what SignalStack solves.

**The workflow:**
```
SignalStack (Intelligence)          →          Outreach Tool (Execution)
─────────────────────────                      ──────────────────────────
Research companies                             Import qualified leads
Enrich from 14+ sources                        Create personalized sequences
Score against ICP                              Send multi-touch campaigns
Generate intelligence briefs                   Track opens, replies, meetings
Identify buyer personas                        Manage cadence timing
Write outreach angles                          A/B test messaging
Flag signal convergence                        Report on pipeline metrics
Export to your stack            ──────→        Execute with confidence
```

**The result:** Your reps stop spending time on research and start spending time on selling — with intelligence briefs that make every conversation relevant.

---

Built with Claude AI by Anthropic.
