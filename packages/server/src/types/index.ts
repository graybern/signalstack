export type UserRole = 'superadmin' | 'admin' | 'operator' | 'member' | 'viewer';

export interface User {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: UserRole;
  created_at: string;
}

export interface PipelineRun {
  id: string;
  triggered_by: string | null;
  campaign_id: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  started_at: string | null;
  completed_at: string | null;
  lead_count: number;
  error_message: string | null;
  input_tokens: number;
  output_tokens: number;
  estimated_cost: number;
  model_used: string | null;
  created_at: string;
}

export type SourceType = 'outbound_research' | 'outbound_campaign' | 'inbound_csv' | 'inbound_manual' | 'inbound_webhook';
export type LeadStatus = 'imported' | 'enriching' | 'scored' | 'qualified' | 'disqualified' | 'contacted' | 'won' | 'lost';

export interface Lead {
  id: string;
  run_id: string;
  campaign_id: string | null;
  company_name: string;
  segment: 'ENT' | 'MM' | 'SMB';
  hq_location: string | null;
  employee_count: number | null;
  founded_year: number | null;
  funding_stage: string | null;
  total_funding: string | null;
  investors: string | null;
  website: string | null;
  source_type: SourceType;
  lead_status: LeadStatus;
  domain: string | null;
  import_id: string | null;
  convergence_score: number;
  convergence_details: string | null;
  fit_score: number;
  fit_score_label: string;
  confidence: 'low' | 'medium' | 'high';
  why_now: string | null;
  score_breakdown: string | null;
  pain_hypotheses: string | null;
  tech_stack: string | null;
  competitive_displacement: string | null;
  outreach_strategy: string | null;
  source_citations: string | null;
  brief_markdown: string | null;
  created_at: string;
}

export interface Persona {
  id: string;
  lead_id: string;
  role_type: 'champion' | 'economic_buyer' | 'executive_sponsor';
  name: string | null;
  title: string | null;
  linkedin_url: string | null;
  department: string | null;
  tenure: string | null;
  outreach_angle: string | null;
  talking_points: string | null;
  outreach_message: string | null;
  social_signals: string | null;
  buying_signals: string | null;
  created_at: string;
}

export interface LeadFeedback {
  id: string;
  lead_id: string;
  user_id: string;
  verdict: 'bad_fit' | 'good_fit_response' | 'good_fit_booked' | 'good_fit_try_again' | 'good_fit_no_response';
  reason: string | null;
  retry_date: string | null;
  feedback_source: string;
  created_at: string;
}

export interface RecommendationLedger {
  id: string;
  company_name: string;
  domain: string | null;
  first_recommended_at: string;
  last_recommended_at: string;
  times_recommended: number;
}

export type ExclusionCategory = 'disqualifying_criteria' | 'existing_customers' | 'competitors' | 'previous_rejections' | 'custom';

export interface Exclusion {
  id: string;
  company_name: string;
  domain: string | null;
  industry: string | null;
  employees: string | null;
  reason: string | null;
  category: ExclusionCategory;
  added_by: string | null;
  created_at: string;
}

export interface ICPConfig {
  id: string;
  version: number;
  segments: string;
  verticals: string;
  tech_signals: string;
  competitors: string;
  success_stories: string | null;
  updated_by: string | null;
  created_at: string;
}

export interface ScoreBreakdown {
  segment_scale_fit: { points: number; evidence: string[] };
  why_now_triggers: { points: number; evidence: string[] };
  remote_access_pain: { points: number; evidence: string[] };
  displacement_wedge: { points: number; evidence: string[] };
  vertical_playbook: { points: number; evidence: string[] };
  buyer_access_readiness: { points: number; evidence: string[] };
  penalties: { points: number; reason: string }[];
  feedback_adjustments?: { points: number; reason: string }[];
  total: number;
}

export interface PainHypothesis {
  claim: string;
  why_it_matters: string;
  evidence_strength?: 'confirmed' | 'inferred';
}

export interface TechStackIntel {
  vpn_product: { product: string; confidence: string; evidence: string; source: string } | null;
  pam_product: { product: string; confidence: string; evidence: string; source: string } | null;
  recent_purchases: { category: string; product: string; confidence: string; evidence: string; source: string }[];
  cloud_infra: string[];
  dev_tools: string[];
  notes: string;
}

export interface CompetitiveDisplacement {
  likely_current: string[];
  evidence_sources: { signal: string; url: string; confidence: string }[];
  twingate_wedge: string[];
  proof_points_to_use: string[];
}

export interface SourceCitation {
  type: string;
  url: string;
  label: string;
}

export interface LeadBriefFull extends Lead {
  personas: Persona[];
  feedback: LeadFeedback[];
  score_breakdown_parsed: ScoreBreakdown | null;
  pain_hypotheses_parsed: PainHypothesis[] | null;
  tech_stack_parsed: TechStackIntel | null;
  competitive_displacement_parsed: CompetitiveDisplacement | null;
  sources_parsed: SourceCitation[] | null;
  why_now_parsed: string[] | null;
}

export interface SearchPattern {
  name: string;
  description: string;
  examples: string[];
  keywords: string[];
}

export interface Campaign {
  id: string;
  name: string;
  description: string | null;
  pattern_thesis: string;
  example_companies: string; // JSON
  target_signals: string;    // JSON
  anti_patterns: string;     // JSON
  target_categories: string; // JSON
  search_patterns: string;   // JSON
  value_prop_angle: string | null;
  target_count: number;
  status: 'active' | 'archived';
  created_by: string | null;
  created_at: string;
  updated_at: string;
  icp_overrides: string | null;
  pipeline_overrides: string | null;
  prompt_overrides: string | null;
  source_overrides: string | null;
  schedule_cron: string | null;
  schedule_enabled: number;
  exclusion_config: string | null;
  rss_enabled: number;
  funnel_config: string | null;
  notification_destinations: string | null;
}

export type FunnelStepId = 'discover' | 'qualify' | 'enrich' | 'score' | 'brief';

export interface FunnelStepConfig {
  id: FunnelStepId;
  enabled: boolean;
  model?: string;
  prompt_instructions?: string;
  prompt_mode?: 'append' | 'override';
  max_tokens?: number;
  candidate_limit?: number;
  qualification_criteria?: string[];
  disqualification_criteria?: string[];
  source_overrides?: Record<string, boolean>;
  outreach_tone?: string;

  // ── Discover levers ──
  source_strategy?: 'open' | 'guided' | 'restricted' | 'search_augmented';
  research_sources?: { source: string; guidance: string }[];
  search_max_queries?: number;
  search_max_results_per_query?: number;
  target_segments?: { smb: boolean; mm: boolean; ent: boolean };
  lead_count_min?: number;
  lead_count_max?: number;
  // Post-discover filter controls
  filter_existing_leads?: boolean;
  filter_ledger_days?: number;          // skip companies recommended within N days (default 90)
  filter_min_employees?: number;        // hard floor regardless of segment
  filter_allow_snoozed_retry?: boolean; // re-include leads whose snooze expired
  geographic_focus?: string[];
  funding_stage_filter?: string[];
  recency_months?: number;
  verticals_override?: string[];
  use_org_verticals?: boolean;
  technology_categories?: string[];
  sizing_method?: 'employee_count' | 'engineering_headcount' | 'vpn_users' | 'revenue_range';
  sizing_guidance?: string;
  // Domain validation + light enrichment (runs as sub-phases of discover)
  validate_domains?: boolean;           // DNS+HTTP check discovered domains (default true)
  light_enrich?: boolean;               // Run website+DNS enrichment before qualify (default true)

  // ── Qualify levers ──
  segment_filter?: { smb: boolean; mm: boolean; ent: boolean };
  employee_range?: { min?: number; max?: number };
  qualify_funding_stages?: string[];
  geo_filter?: { include?: string[]; exclude?: string[] };
  match_mode?: 'any' | 'all';
  min_signal_count?: number;

  // ── Enrich levers ──
  min_enrichment_sources?: number;      // Require N enrichment sources to pass to score (default 1)
  skip_sources?: string[];              // Sources already run in light enrichment (internal use)

  // ── Score levers ──
  scoring_weights?: {
    segment_scale_fit?: number;
    why_now_triggers?: number;
    remote_access_pain?: number;
    displacement_wedge?: number;
    vertical_playbook?: number;
    buyer_access_readiness?: number;
  };
  min_score_threshold?: number;
  icp_verticals_override?: string[];
  icp_tech_signals_override?: string[];
  icp_competitors_override?: string[];
  use_org_icp?: boolean;
  confidence_filter?: 'all' | 'medium_high' | 'high_only';

  // ── Brief levers ──
  persona_types?: ('champion' | 'economic_buyer' | 'executive_sponsor')[];
  brief_depth?: 'quick' | 'standard' | 'comprehensive';
}

export interface FunnelConfig {
  version: number;
  steps: FunnelStepConfig[];
}

export interface CampaignExclusionConfig {
  additions: { company_name: string; domain?: string; reason?: string; category?: string }[];
  exemptions: string[]; // IDs of global exclusions to exempt
}

// ── Notification Destinations ──────────────────────────────────────

export type NotificationDestinationType = 'slack' | 'webhook' | 'teams';

export interface NotificationDestinationBase {
  id: string;
  type: NotificationDestinationType;
  label: string;
  enabled: boolean;
  created_at: string;
}

export interface SlackDestination extends NotificationDestinationBase {
  type: 'slack';
  config: { webhook_url: string };
}

export interface WebhookDestination extends NotificationDestinationBase {
  type: 'webhook';
  config: {
    url: string;
    method?: 'POST' | 'PUT';
    headers?: Record<string, string>;
    secret?: string;
  };
}

export interface TeamsDestination extends NotificationDestinationBase {
  type: 'teams';
  config: { webhook_url: string };
}

export type NotificationDestination = SlackDestination | WebhookDestination | TeamsDestination;

export interface CampaignParsed {
  id: string;
  name: string;
  description: string | null;
  pattern_thesis: string;
  example_companies: { name: string; domain: string; why_they_fit: string }[];
  target_signals: string[];
  anti_patterns: string[];
  target_categories: string[];
  search_patterns: SearchPattern[];
  value_prop_angle: string | null;
  target_count: number;
  status: 'active' | 'archived';
  created_by: string | null;
  created_at: string;
  updated_at: string;
  icp_overrides: Record<string, any> | null;
  pipeline_overrides: Record<string, any> | null;
  prompt_overrides: Record<string, any> | null;
  source_overrides: Record<string, any> | null;
  schedule_cron: string | null;
  schedule_enabled: number;
  exclusion_config: CampaignExclusionConfig | null;
  rss_enabled: number;
  funnel_config: FunnelConfig | null;
  notification_destinations: NotificationDestination[];
}

export interface InboundImport {
  id: string;
  filename: string | null;
  source_type: SourceType;
  row_count: number;
  processed_count: number;
  qualified_count: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error_message: string | null;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface InboundLeadInput {
  company_name: string;
  domain?: string;
  segment?: 'ENT' | 'MM' | 'SMB';
  contact_name?: string;
  contact_email?: string;
  contact_title?: string;
  notes?: string;
  source?: string;
}

export interface ICPSegmentConfig {
  vpn_users_min: number;
  vpn_users_max: number;
}

export interface ICPConfigParsed {
  segments: { SMB: ICPSegmentConfig; MM: ICPSegmentConfig; ENT: ICPSegmentConfig };
  verticals: string[];
  tech_signals: string[];
  competitors: string[];
  success_stories: Record<string, string[]>;
}
