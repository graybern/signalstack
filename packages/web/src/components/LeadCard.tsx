import { Link } from 'react-router-dom';
import { ScoreBadge, ConfidenceBadge, SegmentBadge } from './ScoreBadge';
import { Building2, Users, MapPin, ExternalLink, ThumbsUp, ThumbsDown, Zap } from 'lucide-react';
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

export function LeadCard({ lead }: LeadCardProps) {
  const painHypotheses = lead.pain_hypotheses_parsed || [];
  const whyNow = lead.why_now_parsed || [];
  const topPersona = lead.personas?.[0];
  const feedback = lead.feedback?.[0];

  return (
    <Link
      to={`/leads/${lead.id}`}
      className="block bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md hover:border-brand-200 transition-all group"
    >
      <div className="flex items-start gap-4">
        <ScoreBadge score={lead.fit_score} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-gray-900 group-hover:text-brand-700 truncate">
              {lead.company_name}
            </h3>
            <SegmentBadge segment={lead.segment} />
            <ConfidenceBadge confidence={lead.confidence || 'medium'} />
            {lead.source_type && lead.source_type !== 'outbound_research' && lead.source_type !== 'outbound_campaign' && (
              <SourceBadge sourceType={lead.source_type} />
            )}
            {lead.convergence_score > 50 && (
              <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded-full">
                <Zap className="w-3 h-3" /> Convergence
              </span>
            )}
            {lead.lead_status && lead.lead_status !== 'scored' && (
              <StatusBadge status={lead.lead_status} />
            )}
            {feedback && (
              <span className={`flex items-center gap-1 text-xs ${feedback.verdict === 'good_fit' ? 'text-emerald-600' : 'text-red-500'}`}>
                {feedback.verdict === 'good_fit' ? <ThumbsUp className="w-3 h-3" /> : <ThumbsDown className="w-3 h-3" />}
              </span>
            )}
          </div>

          <div className="flex items-center gap-4 text-xs text-gray-500 mb-2">
            {lead.hq_location && (
              <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{lead.hq_location}</span>
            )}
            {lead.employee_count && (
              <span className="flex items-center gap-1"><Users className="w-3 h-3" />~{lead.employee_count.toLocaleString()} employees</span>
            )}
            {lead.funding_stage && (
              <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{lead.funding_stage}</span>
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
