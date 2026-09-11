# Software SDR → SignalStack Ingestion Contract v1.0

> Ingestion contract for leads flowing from Software SDR into SignalStack.
> This is the source of truth both sides implement against.
> September 2026

## Overview

Software SDR pushes batches of leads to SignalStack via a single HTTP endpoint. SignalStack receives, deduplicates, creates/updates leads, maps contacts to personas, and runs its campaign pipeline. Unidirectional — no write-back, no pull.

**Pipeline:** ~~discover~~ → qualify → enrich → score → brief → audit

Software SDR replaces the discover step. Its output lands in a dedicated campaign ("Software SDR Inbound") with discover disabled. SignalStack layers its own enrichment (14 data sources), deterministic ICP scoring (7 dimensions), and AI-generated outreach briefs on top.

**Campaign ID:** `784deb78-aa63-4032-8666-8e504470289b`

## Endpoint

```
POST https://signalstack.dokploy.twindemo.dev/api/inbound/ingest
Content-Type: application/json
x-api-key: ss_<your-key>
```

Create an API key in SignalStack under **Settings → Profile → API Keys** with at least `leads:write` scope.

## Payload Schema

```json
{
  "schema_version": "1.0",
  "batch_id": "sdr-2026-09-10-weekly",
  "campaign_id": "784deb78-aa63-4032-8666-8e504470289b",
  "accounts": [
    {
      "domain": "acme-security.com",
      "company_name": "Acme Security",
      "employee_count": 450,
      "hq_location": "San Francisco, CA",
      "segment": "MM",
      "linkedin_company_url": "https://linkedin.com/company/acme-security",
      "sdr_score": 78,
      "icp_tier": 1,
      "archetype": "cloud_security_vendor",
      "qualification": "qualified",
      "justification": "Active VPN replacement signals from job postings",
      "ats_source": "greenhouse",
      "signals": [
        {
          "category": "vpn_vendor",
          "description": "Job posting mentions 'Cisco AnyConnect migration'",
          "source_url": "https://boards.greenhouse.io/acme/jobs/123",
          "date": "2026-09-03"
        }
      ],
      "contacts": [
        {
          "name": "Jane Smith",
          "title": "Director of IT Security",
          "email": "jane.smith@acme-security.com",
          "linkedin_url": "https://linkedin.com/in/janesmith",
          "function": "security",
          "seniority": "director",
          "score": 85,
          "passes_checks": true
        }
      ]
    }
  ]
}
```

## Field Reference

### Top-level

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `schema_version` | string | **required** | `"1.0"` for this contract version |
| `batch_id` | string | **required** | Idempotency key. Use a descriptive slug: `sdr-2026-09-10-weekly` |
| `campaign_id` | string | optional | UUID of the target campaign. Falls back to default campaign. |
| `accounts` | array | **required** | 1–100 account objects |

### Account fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `domain` | string | **required** | Canonical domain. Primary dedup key. Cleaned on receipt. |
| `company_name` | string | **required** | Display name. |
| `employee_count` | number | recommended | Determines segment (SMB/MM/ENT). Without it, defaults to MM. |
| `hq_location` | string | recommended | Free text. Used for geo filtering. |
| `segment` | string | optional | `ENT` \| `MM` \| `SMB`. Auto-computed from employee_count if absent. |
| `linkedin_company_url` | string | recommended | Full URL. Saves a lookup step. |
| `sdr_score` | number | optional | Software SDR's time-decayed company score. Stored as metadata. |
| `icp_tier` | number\|string | optional | `1` \| `2` \| `3` \| `"disqualified"` |
| `archetype` | string | optional | One of Software SDR's 14 business archetype values. |
| `qualification` | string | optional | `"qualified"` \| `"unqualified"` |
| `justification` | string | optional | Free-text reasoning. Stored for audit trail. |
| `ats_source` | string | optional | Which ATS board: `greenhouse`, `lever`, `ashby`, etc. |
| `founded_year` | number | optional | e.g. `2018` |
| `funding_stage` | string | optional | e.g. `"Series C"` |
| `industry` | string | optional | Free text. |
| `signals` | array | recommended | 0–50 signal objects. See below. |
| `contacts` | array | recommended | 0–10 contact objects. See below. |

### Signal object

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `category` | string | **required** | See recognized categories below |
| `description` | string | **required** | Human-readable signal text |
| `source_url` | string | optional | URL where this signal was found |
| `date` | string | optional | ISO date (YYYY-MM-DD) when the signal was observed |

### Recognized signal categories

| Category | What it means | SignalStack mapping |
|----------|---------------|---------------------|
| `vpn_vendor` | Legacy VPN product mentioned (Cisco AnyConnect, FortiClient, etc.) | `fact_sheet.vpn_products_detected[]` |
| `competitor` | ZTNA competitor mentioned (Tailscale, Zscaler, etc.) | `fact_sheet.competitor_products_detected[]` |
| `hiring_surge` | Spike in IT/Security/Infra job postings | `fact_sheet.hiring_signals[]` |
| `leadership_change` | New CISO, CTO, VP Eng hire | `fact_sheet.leadership_changes[]` |
| `remote_workforce` | Remote-first / distributed team language | `fact_sheet.remote_workforce_evidence` |
| `gaming_vertical` | Perforce, dev kits, render farms, game engine | Vertical match boost |
| `byoc` | Customer-managed deployment / private networking | BYOC displacement signal |
| `compliance` | SOC 2 / PCI / HIPAA / ISO 27001 initiative | `fact_sheet.compliance_signals[]` |
| `funding` | Funding round, IPO prep | `fact_sheet.funding_events[]` |
| `twingate_mention` | Company already uses Twingate | **Auto-suppressed** → added to exclusions |

Unknown categories are accepted — the description text flows into SignalStack's AI fact extraction regardless. Named categories get structured mapping.

**Important:** Any account with a `twingate_mention` signal or "twingate" in any signal description is automatically added to SignalStack's exclusion list and skipped.

### Contact object

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | **required** | Full name |
| `title` | string | recommended | Job title |
| `email` | string | optional | PII — logged by ID only |
| `linkedin_url` | string | recommended | Personal LinkedIn profile URL |
| `function` | string | recommended | `security` \| `infrastructure` \| `engineering` \| `it` \| `devops` \| `networking` \| etc. |
| `seniority` | string | recommended | `director` \| `vp` \| `ciso` \| `cto` \| `manager` \| `lead` \| `head` \| etc. |
| `relationship` | string | optional | e.g. `"first_degree"` — warm intro path |
| `score` | number | optional | Software SDR's per-contact score (0–100) |
| `passes_checks` | boolean | optional | Whether the contact passed SDR validation |

### Role-fit mapping (function + seniority → SignalStack persona)

| Function + Seniority | → Persona type |
|----------------------|----------------|
| Any + cto / cio / cso / ciso | `executive_sponsor` |
| Any + vp / svp | `economic_buyer` |
| security / infrastructure / networking / it + director / head / manager | `technical_champion` |
| engineering / devops / sre / platform + any | `hands_on_keyboard` |
| Anything else | `technical_champion` (default) |

## Response

### Success — 200

```json
{
  "batch_id": "sdr-2026-09-10-weekly",
  "run_id": "8db8d0c4-d092-4534-b085-523018e02c20",
  "campaign_id": "784deb78-aa63-4032-8666-8e504470289b",
  "accounts_received": 25,
  "accounts_new": 18,
  "accounts_updated": 5,
  "accounts_skipped": 2,
  "status": "processing",
  "errors": [
    { "domain": "(unknown)", "error": "domain is required" }
  ]
}
```

### Error codes

| Status | Meaning |
|--------|---------|
| 200 | Batch accepted. Valid accounts processing; invalid listed in `errors[]`. |
| 400 | Request-level validation failure (no accounts, no campaign, campaign not found). |
| 401 | Missing or invalid API key. |
| 409 | Pipeline run already in progress for this campaign. Wait and retry. |

## Dedup & Upsert

**Dedup key:** `domain` within the target campaign.

- **New domain** → creates lead, runs full pipeline
- **Existing domain, new signals** → merges signals, replaces contacts with fresh set, updates SDR metadata, re-runs pipeline
- **Excluded domain** → skipped (global exclusions + customer profiles)
- **Twingate mention** → auto-added to exclusions, skipped

Re-pushing the same batch is safe. New signals are merged (union); contacts are replaced with the latest set.

## Limits

| Limit | Value | Rationale |
|-------|-------|-----------|
| Accounts per batch | **100** | Each runs through enrichment + AI scoring + AI brief. ~30–60 min. |
| Contacts per account | **10** | Excess silently truncated. |
| Signals per account | **50** | Excess silently truncated. |
| Payload size | **10 MB** | Express JSON limit. |
| Concurrent runs | **1 per campaign** | Returns 409 if in progress. |

## Versioning

The `schema_version` field tracks the contract version:
- **Adding a field** → minor bump (1.0 → 1.1). Backward compatible.
- **Removing or renaming** → major bump (1.x → 2.0). Requires coordination.
- **New signal categories** → no version bump. Unknown categories accepted.

## Deployment

Separate Dokploy projects. Software SDR pushes to SignalStack's public endpoint over HTTPS.

| | Software SDR | SignalStack |
|---|---|---|
| Stack | FastAPI + PostgreSQL 16 | Express + SQLite |
| Deployment | Own Dokploy project | Own Dokploy project |
| Push URL | — | `https://signalstack.dokploy.twindemo.dev/api/inbound/ingest` |
| Auth | Sends `x-api-key` | Validates against `api_keys` table |
| Cadence | Weekly cron (owned by SDR) | Processes on receipt |

## Open Questions for Ben

1. **Volume per batch** — rough estimate: 10 accounts? 50? 100? Current limit is 100 but can be raised.
2. **Re-enrichment** — Software SDR already enriches. SignalStack layers 14 more sources on top. Should any be skipped?
3. **Contact email handling** — emails are PII. SignalStack stores them on the persona record. Acceptable?
4. **Archetype enum values** — What are the 14 closed `business_archetype` values? SignalStack can map them to FactSheet industry fields.
5. **Containerization timeline** — when is Software SDR ready for a Dokploy deployment? SignalStack endpoint is live now.
