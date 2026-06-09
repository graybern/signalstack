import { Link } from 'react-router-dom';
import { ScoreBadge, ConfidenceBadge, SegmentBadge, GradeBadge, MiniGauge, DualBars, WatchBadge, deriveActionState, ACTION_CONFIG } from './ScoreBadge';
import type { ActionState } from './ScoreBadge';
import { Building2, Users, MapPin, ExternalLink, ThumbsUp, ThumbsDown, Minus, Zap } from 'lucide-react';
import { clsx } from 'clsx';
import { stripMarkdown } from '../utils/inlineMarkdown';

interface LeadCardProps {
  lead: any;
}

function SourceBadge({ sourceType }: { sourceType: string }) {
  const styles: Record<string, string> = {
    inbound_csv: 'bg-blue-50 text-blue-700',
    inbound_manual: 'bg-indigo-50 text-indigo-700',
    inbound_webhook: 'bg-violet-50 text-violet-700',
  };
  const labels: Record<string, string> = {
    inbound_csv: 'CSV',
    inbound_manual: 'Manual',
    inbound_webhook: 'Webhook',
  };
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded-full ${styles[sourceType] || 'bg-gray-50 text-gray-600'}`}>
      {labels[sourceType] || sourceType}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    qualified: 'bg-emerald-50 text-emerald-700',
    disqualified: 'bg-red-50 text-red-700',
    contacted: 'bg-blue-50 text-blue-700',
    enriching: 'bg-amber-50 text-amber-700',
    imported: 'bg-gray-50 text-gray-600',
    won: 'bg-emerald-100 text-emerald-800',
    lost: 'bg-red-100 text-red-800',
  };
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded-full ${styles[status] || 'bg-gray-50 text-gray-600'}`}>
      {status}
    </span>
  );
}

const ACTION_VERB_STYLES: Record<ActionState, { text: string; bg: string }> = {
  engage: { text: 'text-emerald-700', bg: 'bg-emerald-50' },
  watch: { text: 'text-amber-700', bg: 'bg-amber-50' },
  research: { text: 'text-sky-700', bg: 'bg-sky-50' },
  pass: { text: 'text-gray-500', bg: 'bg-gray-100' },
  watching: { text: 'text-violet-700', bg: 'bg-violet-50' },
};

const ACTION_BORDER: Record<ActionState, string> = {
  engage: 'border-l-emerald-400',
  watch: 'border-l-amber-400',
  research: 'border-l-sky-400',
  pass: 'border-l-gray-300',
  watching: 'border-l-violet-400',
};

export function LeadCard({ lead }: LeadCardProps) {
  const painHypotheses = lead.pain_hypotheses_parsed || [];
  const whyNow = lead.why_now_parsed || [];
  const topPersona = lead.personas?.[0];
  const feedback = lead.feedback?.[0];

  const isV2 = lead.scoring_version === 2 && lead.dimensions_parsed;
  const actionState = isV2 ? deriveActionState(lead.dimensions_parsed, lead.watch_status === 'active') : null;
  const actionVerb = actionState ? ACTION_CONFIG[actionState] : null;
  const verbStyle = actionState ? ACTION_VERB_STYLES[actionState] : null;
  const borderAccent = actionState ? ACTION_BORDER[actionState] : '';

  return (
    <Link
      to={`/leads/${lead.id}`}
      className={clsx(
        'block bg-white rounded-xl border p-5 hover:shadow-md transition-all group',
        isV2 ? `border-l-[3px] ${borderAccent} border-gray-200 hover:border-gray-300` : 'border-gray-200 hover:border-brand-200',
      )}
    >
      <div className="flex items-start gap-4">
        <ScoreBadge score={lead.fit_score} />

        <div className="flex-1 min-w-0">
          {/* Row 1: Company + Segment + Action verdict */}
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-gray-900 group-hover:text-brand-700 truncate">
              {lead.company_name}
            </h3>
            <SegmentBadge segment={lead.segment} />
            {isV2 && actionVerb && verbStyle ? (
              <span className={clsx('text-[10px] font-semibold px-1.5 py-0.5 rounded-full', verbStyle.text, verbStyle.bg)}>
                {actionVerb.verb}
              </span>
            ) : (
              <ConfidenceBadge confidence={lead.confidence || 'medium'} />
            )}
            {feedback && (
              <span className={`flex items-center gap-1 text-xs ${
                ['closed_won', 'good_fit_booked', 'good_fit_response', 'good_fit'].includes(feedback.verdict) ? 'text-emerald-600'
                : ['existing_customer'].includes(feedback.verdict) ? 'text-purple-600'
                : ['stalled', 'nurture', 'good_fit_try_again', 'good_fit_no_response'].includes(feedback.verdict) ? 'text-amber-600'
                : 'text-red-500'
              }`}>
                {['closed_won', 'good_fit_booked', 'good_fit_response', 'good_fit'].includes(feedback.verdict)
                  ? <ThumbsUp className="w-3 h-3" />
                  : ['existing_customer', 'stalled', 'nurture', 'good_fit_try_again', 'good_fit_no_response'].includes(feedback.verdict)
                  ? <Minus className="w-3 h-3" />
                  : <ThumbsDown className="w-3 h-3" />}
              </span>
            )}
          </div>

          {/* Row 2 (v2): Scoring bars + badges — promoted above metadata */}
          {isV2 && lead.dimensions_parsed && (
            <div className="flex items-center gap-2 mb-2">
              <DualBars
                potential={lead.dimensions_parsed.potential_score ?? lead.dimensions_parsed.icp_fit}
                urgency={lead.dimensions_parsed.urgency_score ?? lead.dimensions_parsed.timing}
                evidenceModifier={lead.dimensions_parsed.evidence_modifier}
              />
              {lead.dimensions_parsed.data_confidence && (
                <GradeBadge grade={lead.dimensions_parsed.data_confidence} size="sm" />
              )}
              {lead.watch_status && (
                <WatchBadge
                  wakeDate={lead.watch_wake_date}
                  category={lead.watch_category}
                  compact
                />
              )}
            </div>
          )}

          {/* Row 2/3: Metadata + secondary badges */}
          <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
            {lead.hq_location && (
              <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{lead.hq_location}</span>
            )}
            {lead.employee_count && (
              <span className="flex items-center gap-1"><Users className="w-3 h-3" />~{lead.employee_count.toLocaleString()}</span>
            )}
            {lead.funding_stage && (
              <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{lead.funding_stage}</span>
            )}
            {lead.source_type && lead.source_type !== 'outbound_research' && lead.source_type !== 'outbound_campaign' && (
              <SourceBadge sourceType={lead.source_type} />
            )}
            {lead.convergence_score > 50 && (
              <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded-full">
                <Zap className="w-3 h-3" /> Converge
              </span>
            )}
            {lead.lead_status && lead.lead_status !== 'scored' && (
              <StatusBadge status={lead.lead_status} />
            )}
          </div>

          {whyNow.length > 0 && (
            <p className="text-sm text-gray-700 mb-2 line-clamp-2">
              <span className="font-medium text-brand-700">Why now: </span>
              {stripMarkdown(whyNow[0])}
            </p>
          )}

          {painHypotheses.length > 0 && (
            <p className="text-sm text-gray-600 line-clamp-1">
              {painHypotheses[0]?.claim || painHypotheses[0]}
            </p>
          )}

          {topPersona && topPersona.name && (
            <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
              <span className="font-medium">Target:</span>
              <span>{topPersona.name} — {topPersona.title}</span>
              {topPersona.linkedin_url && <ExternalLink className="w-3 h-3" />}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
