export type UserRole = 'superadmin' | 'admin' | 'operator' | 'member' | 'viewer';

export interface User {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: UserRole;
  status: 'active' | 'suspended';
  must_change_password: number;
  last_login_at: string | null;
  timezone: string | null;
  created_at: string;
}

export interface ApiKey {
  id: string;
  user_id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  scopes: string;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
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

export type SourceType = 'outbound_research' | 'outbound_campaign' | 'inbound_csv' | 'inbound_manual' | 'inbound_webhook' | 'quick_research' | 'batch_research' | 'webhook_research';
export type LeadStatus = 'imported' | 'enriching' | 'scored' | 'qualified' | 'disqualified' | 'contacted' | 'won' | 'lost' | 'meeting_booked' | 'closed_won' | 'closed_lost' | 'customer' | 'stalled' | 'nurture';

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

export type FeedbackVerdict =
  | 'bad_fit' | 'good_fit_response' | 'good_fit_booked' | 'good_fit_try_again' | 'good_fit_no_response'
  | 'closed_won' | 'closed_lost' | 'existing_customer' | 'stalled' | 'nurture'
  | 'good_fit' | 'not_fit';

export type BadFitReason = 'wrong_segment' | 'too_small' | 'too_large' | 'wrong_vertical' | 'wrong_geo' | 'no_budget' | 'wrong_product_fit' | 'already_has_competitor' | 'other';
export type LossReason = 'price' | 'feature_gap' | 'competitor_relationship' | 'timing' | 'no_decision' | 'champion_left' | 'procurement_block' | 'other';
export type EffectiveChannel = 'email' | 'linkedin' | 'cold_call' | 'referral' | 'event' | 'inbound' | 'other';
export type StalledStage = 'initial_outreach' | 'after_first_meeting' | 'during_evaluation' | 'procurement';

export interface LeadFeedback {
  id: string;
  lead_id: string;
  user_id: string;
  verdict: FeedbackVerdict;
  reason: string | null;
  retry_date: string | null;
  feedback_source: string;
  created_at: string;
}

export interface FeedbackOutcomeDetails {
  id: string;
  feedback_id: string;
  lead_id: string;
  campaign_id: string | null;
  effective_persona: string | null;
  effective_channel: EffectiveChannel | null;
  effective_angle: string | null;
  deal_value: string | null;
  sales_cycle_days: number | null;
  competitor_lost_to: string | null;
  loss_reason: LossReason | null;
  bad_fit_reasons: string | null;
  customer_products: string | null;
  customer_environment: string | null;
  why_they_bought: string | null;
  stalled_stage: StalledStage | null;
  created_at: string;
}

export interface CustomerProfile {
  id: string;
  company_name: string;
  domain: string | null;
  products_used: string | null;
  environment: string | null;
  why_they_bought: string | null;
  deal_value: string | null;
  close_date: string | null;
  original_lead_id: string | null;
  campaign_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type InsightType = 'scoring_accuracy' | 'persona_effectiveness' | 'vertical_performance' | 'messaging_patterns' | 'timing_patterns' | 'competitive_intel' | 'composite';
export type InsightStatus = 'active' | 'applied' | 'dismissed' | 'stale';

export interface CampaignInsight {
  id: string;
  campaign_id: string;
  insight_type: InsightType;
  title: string;
  summary: string;
  details: Record<string, any>;
  recommendations: Record<string, any>[] | null;
  data_snapshot: Record<string, any> | null;
  feedback_count: number;
  confidence: 'low' | 'medium' | 'high';
  status: InsightStatus;
  created_at: string;
  applied_at: string | null;
  applied_by: string | null;
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

export interface TechStackItem {
  product: string;
  confidence: 'high' | 'medium' | 'low';
  evidence: string;
  source: string;
}

export interface TechStackCategory {
  id: string;
  label: string;
  examples: string[];
}

export interface TechStackIntel {
  vpn_product: TechStackItem | null;
  pam_product: TechStackItem | null;
  recent_purchases: (TechStackItem & { category: string })[];
  cloud_infra: (string | TechStackItem)[];
  dev_tools: (string | TechStackItem)[];
  categories?: Record<string, TechStackItem[]>;
  notes: string;
}

export interface CompetitiveProduct {
  product: string;
  confidence: 'confirmed' | 'inferred';
  evidence: string;
  source?: string;
}

export interface CompetitiveDisplacement {
  displacement_narrative?: string;
  likely_current: (string | CompetitiveProduct)[];
  evidence_sources: { signal: string; url: string; confidence: string }[];
  twingate_wedge: string[];
  proof_points_to_use: string[];
}

export interface SourceCitation {
  id?: number;
  type: string;
  url: string;
  label: string;
  confidence?: 'confirmed' | 'inferred';
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
  schedule_timezone: string | null;
  exclusion_config: string | null;
  rss_enabled: number;
  funnel_config: string | null;
  notification_destinations: string | null;
  notification_base_url: string | null;
}

export type FunnelStepId = 'discover' | 'qualify' | 'enrich' | 'score' | 'brief' | 'audit';

export interface AuditIssue {
  check: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface AuditResult {
  score: number;
  passed: boolean;
  issues: AuditIssue[];
  checks: Record<string, { passed: boolean; score: number; details?: string }>;
}

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
  tech_stack_categories?: TechStackCategory[];

  // ── Audit levers ──
  audit_quality_threshold?: number;
  audit_use_ai?: boolean;
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

export type NotificationDestinationType = 'webhook' | 'rss';
export type WebhookPayloadFormat = 'slack' | 'teams' | 'json' | 'generic';

export interface NotificationDestinationBase {
  id: string;
  type: NotificationDestinationType;
  label: string;
  enabled: boolean;
  created_at: string;
}

export interface WebhookDestination extends NotificationDestinationBase {
  type: 'webhook';
  config: {
    url: string;
    format: WebhookPayloadFormat;
    method?: 'POST' | 'PUT';
    headers?: Record<string, string>;
    secret?: string;
  };
}

export interface RssDestination extends NotificationDestinationBase {
  type: 'rss';
  config: Record<string, never>;
}

export type NotificationDestination = WebhookDestination | RssDestination;

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
  schedule_timezone: string | null;
  exclusion_config: CampaignExclusionConfig | null;
  rss_enabled: number;
  funnel_config: FunnelConfig | null;
  notification_destinations: NotificationDestination[];
  notification_base_url: string | null;
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

export interface FeedbackPattern {
  pattern: string;
  direction: 'positive' | 'negative';
  count: number;
}

export interface ExtendedICPConfig extends ICPConfigParsed {
  company_context?: {
    company_name: string;
    product_name: string;
    one_liner: string;
    value_props: string[];
    differentiators: string[];
    website: string;
    industry_focus: string;
  };
  geographies?: {
    target_regions: string[];
    target_countries: string[];
    notes: string;
  };
  segment_details?: Record<string, {
    employee_min: number;
    employee_max: number;
    revenue_min: string;
    revenue_max: string;
    funding_stages: string[];
    notes: string;
  }>;
  disqualifiers?: { signal: string; severity: 'hard' | 'soft'; notes: string }[];
  signal_weights?: { signal: string; weight: number; category: string }[];
  buyer_personas?: Record<string, {
    label: string;
    priority: number;
    titles: string[];
    departments: string[];
    notes: string;
  }>;
  excluded_domain_patterns?: string[];
  prompt_config?: {
    research_preamble: string;
    research_additional_instructions: string;
    outreach_tone: string;
    outreach_tone_description: string;
  };
  campaign_target_signals?: string[];
  campaign_value_prop_angle?: string;
}
