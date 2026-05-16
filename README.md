# SignalStack — AI-Powered Prospect Intelligence

**Stack signals from 14+ sources. Qualify leads with AI. Learn from every outcome. Arm your reps with intelligence briefs.**

SignalStack is the intelligence layer that sits before your outreach stack. It answers the two hardest questions in B2B sales: **"Who should we talk to?"** and **"What should we say?"** — and gets better at both with every deal your team closes, loses, or walks away from.

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
5. **Closed-Loop Learning** — Every sales outcome (booked, won, lost, bad fit) feeds back into future scoring, briefing, and targeting — the system improves with every rep interaction
6. **Export to Your Outreach Stack** — SignalStack does the thinking; your outreach tool (Outreach.io, Salesloft, HubSpot, Apollo) does the sending

### Why This Matters

| Without SignalStack | With SignalStack |
|---|---|
| Rep spends 2 hours researching one account | AI researches, enriches, and scores in minutes |
| Single data source, incomplete picture | 14+ sources stacked for full-spectrum intelligence |
| Inbound leads sit unqualified for days | Auto-enriched, scored, and qualified on import |
| No connection between inbound interest and outbound targeting | Signal convergence flags high-priority overlaps |
| Generic outreach, low reply rates | Personalized pain hypotheses and talking points per persona |
| No feedback loop — same mistakes repeated across campaigns | AI learns from every outcome to improve scoring accuracy and brief quality over time |
| Existing customers resurface as new leads | Auto-exclusion: won deals and known customers are filtered from all future runs |

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

## Feedback & Learning System

SignalStack isn't a one-shot pipeline — it's a **learning system** that improves with every sales outcome your team records.

### Outcome Tracking

After a rep acts on a brief, they record what happened through a structured feedback flow:

| Outcome | What It Captures | System Action |
|---------|------------------|---------------|
| **Booked Meeting** | Which persona role and channel worked, what angle resonated | Tracks effective outreach patterns |
| **Closed Won** | Deal value, why they bought, products purchased, effective channel | Auto-adds to exclusion list + customer knowledge base |
| **Closed Lost** | Competitor lost to, loss reason (price, feature gap, timing, etc.) | Feeds competitive intelligence into future briefs |
| **Bad Fit** | Structured reasons (wrong segment, too small, wrong vertical, etc.) | Identifies scoring blind spots |
| **Already a Customer** | Products used, environment details, why they bought | Auto-excludes from all future campaigns |
| **Try Later** | Re-outreach date | Snoozes and resurfaces with a fresh brief on target date |
| **Stalled** | Where in the process they went dark | Timing pattern analysis |

### Cross-Campaign Intelligence

- **Customer dedup** — Companies marked as customers or won deals are automatically excluded from all future campaign runs across the entire platform
- **Cross-campaign lead detection** — When a lead appears in multiple active campaigns, it's flagged so teams can coordinate
- **Customer knowledge base** — Environment data, products used, and buying motivations are captured to refine the ICP over time

### How Learning Feeds Back

Every piece of feedback makes future runs smarter:

1. **Scoring calibration** — If the system consistently scores a type of company high but reps mark them as bad fits, the scoring adjustments surface in the next run's context
2. **Persona effectiveness** — If Champions (Director-level) generate most booked meetings while C-suite cold outreach fails, briefs shift persona targeting accordingly
3. **Messaging guidance** — Angles that resonate in won deals get amplified; angles that correlate with losses get deprioritized
4. **Competitive intelligence** — Loss patterns against specific competitors inform displacement strategies in future briefs

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
    │   │   ├── FeedbackPanel.tsx    # Outcome capture with contextual sub-forms
    │   │   └── ScoreBadge.tsx       # Score/segment/confidence badges
    │   └── api/client.ts           # API client with auth
    └── package.json
```

## Getting Started

### Prerequisites
- Node.js 18+
- **Vertex AI**: A GCP project with Vertex AI enabled + `gcloud` CLI authenticated
- **Or Anthropic API**: An Anthropic API key (`sk-ant-...`)

### Setup

```bash
# Install dependencies
npm install

# Set environment variables
cp .env.example .env
# Edit .env — see "AI Provider" sections below for Vertex AI vs Anthropic API

# Start both server (:3001) and frontend (:5173)
npm run dev
```

### AI Provider: Vertex AI (recommended)

SignalStack uses the Anthropic Vertex AI SDK (`@anthropic-ai/vertex-sdk`) to call Claude. This gives you access to Claude models through your existing GCP project without needing a separate Anthropic API key.

**Required environment variables:**

```bash
CLOUD_ML_REGION=us-east5                          # Vertex AI region
ANTHROPIC_VERTEX_PROJECT_ID=your-gcp-project-id   # GCP project with Vertex AI enabled
```

**Local development** — uses your existing gcloud session (Application Default Credentials):

```bash
# Authenticate with gcloud (one-time)
gcloud auth application-default login

# That's it — the Vertex SDK picks up ADC automatically
```

**Container / self-hosted deployment** — your local gcloud session isn't available inside the container. Two options:

#### Option A: Use your existing ADC credentials (quick setup)

If you've already run `gcloud auth application-default login` locally, you can mount those credentials directly:

```bash
# Find your ADC credentials file
cat ~/.config/gcloud/application_default_credentials.json
```

Mount this file into the container and point the SDK to it:

| Mount | Type | Container Path | Purpose |
|-------|------|----------------|---------|
| **SQLite data** | Volume (persistent) | `/app/packages/server/data` | Database survives container rebuilds |
| **ADC credentials** | File (read-only) | `/app/secrets/sa-key.json` | Vertex AI authentication |

Set these environment variables:

```bash
CLOUD_ML_REGION=us-east5
ANTHROPIC_VERTEX_PROJECT_ID=your-gcp-project-id
GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/sa-key.json
JWT_SECRET=<random-string>              # generate with: openssl rand -base64 32
```

> **Note:** ADC credentials use a refresh token tied to your Google account. If your session is revoked or expires, the container will lose Vertex AI access. For long-running production deployments, use a service account key (Option B).

#### Option B: Create a service account key (production)

```bash
# 1. Create a service account (or use an existing one)
gcloud iam service-accounts create signalstack-vertex \
  --display-name="SignalStack Vertex AI"

# 2. Grant the Vertex AI User role
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:signalstack-vertex@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

# 3. Generate a key file
gcloud iam service-accounts keys create sa-key.json \
  --iam-account=signalstack-vertex@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

Then configure the same two mounts and environment variables as Option A, using the generated `sa-key.json` as the credentials file.

#### Using docker-compose

If using `docker-compose`, both mounts and the env var are already configured in `docker-compose.yml`. Just set `GOOGLE_SA_KEY_PATH` to the path of your credentials file on the host (defaults to `./sa-key.json`).

### AI Provider: Anthropic API (alternative)

If you prefer to use the Anthropic API directly instead of Vertex AI:

```bash
ANTHROPIC_API_KEY=sk-ant-...   # No service account or GCP project needed
```

### First Run

A default admin account is created automatically on first start:
- **Email:** `admin@example.com`
- **Password:** `admin123`

> **⚠️ Change the default password immediately** after first login via Settings > Users.

1. Log in with the default credentials
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
