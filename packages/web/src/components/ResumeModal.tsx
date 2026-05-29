import { useState } from 'react';
import {
  X, PlayCircle, AlertTriangle, ChevronDown, ChevronUp,
  Zap, WifiOff, Clock, Hand, HelpCircle, Shield,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────

interface ResumeLeadDetail {
  id: string;
  company_name: string;
  domain: string;
  pipeline_stage: string;
  fit_score: number | null;
}

interface ResumePlan {
  steps_to_run: string[];
  lead_ids: string[];
  leads_already_complete: number;
  estimated_work: string;
  lead_details: ResumeLeadDetail[];
}

interface ResumeAnalysis {
  original_run_id: string;
  campaign_id: string | null;
  total_leads: number;
  leads_by_stage: Record<string, number>;
  resumable: boolean;
  reason?: string;
  resume_plan: ResumePlan;
}

interface ResumeModalProps {
  analysis: ResumeAnalysis;
  run: {
    error_message?: string | null;
    campaign_name?: string;
    steps_run?: string | null;
    run_type?: string;
    status?: string;
  };
  onConfirm: () => void;
  onCancel: () => void;
  resuming: boolean;
}

// ── Error Classifier ─────────────────────────────────────────────

interface ErrorClassification {
  headline: string;
  advice: string;
  icon: typeof Zap;
  color: string;
}

function classifyError(errorMessage: string | null | undefined, status?: string): ErrorClassification {
  if (status === 'cancelled' || !errorMessage) {
    return {
      headline: 'Run Was Manually Stopped',
      advice: 'Resume will continue where you left off.',
      icon: Hand,
      color: 'text-gray-600',
    };
  }

  const msg = errorMessage.toLowerCase();

  if (msg.includes('529') || msg.includes('overloaded')) {
    return {
      headline: 'AI Service Temporarily Overloaded',
      advice: 'Safe to resume — this is a temporary capacity issue.',
      icon: Zap,
      color: 'text-amber-600',
    };
  }
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('rate_limit')) {
    return {
      headline: 'API Rate Limit Reached',
      advice: 'Wait a few minutes, then resume.',
      icon: Clock,
      color: 'text-amber-600',
    };
  }
  if (msg.includes('econnrefused') || msg.includes('network') || msg.includes('fetch failed') || msg.includes('enotfound')) {
    return {
      headline: 'Connection to AI Service Lost',
      advice: 'Check your internet connection, then resume.',
      icon: WifiOff,
      color: 'text-red-600',
    };
  }
  if (msg.includes('permission') || msg.includes('auth') || msg.includes('401') || msg.includes('403')) {
    return {
      headline: 'Authentication Error',
      advice: 'Check your API credentials before resuming.',
      icon: Shield,
      color: 'text-red-600',
    };
  }

  return {
    headline: 'Unexpected Error',
    advice: 'You can try resuming. If it fails again, contact support.',
    icon: HelpCircle,
    color: 'text-gray-600',
  };
}

// ── Stage / Step Labels ──────────────────────────────────────────

const STAGE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  discovered: { label: 'Discovered', color: 'text-cyan-700', bg: 'bg-cyan-100' },
  qualified:  { label: 'Qualified', color: 'text-gray-700', bg: 'bg-gray-100' },
  enriched:   { label: 'Enriched', color: 'text-blue-700', bg: 'bg-blue-100' },
  scored:     { label: 'Scored', color: 'text-amber-700', bg: 'bg-amber-100' },
  briefed:    { label: 'Briefed', color: 'text-purple-700', bg: 'bg-purple-100' },
  audited:    { label: 'Complete', color: 'text-emerald-700', bg: 'bg-emerald-100' },
};

const STEP_CONFIG: Record<string, { label: string; color: string }> = {
  qualify:  { label: 'Qualify', color: 'bg-gray-100 text-gray-700' },
  enrich:   { label: 'Enrich', color: 'bg-blue-100 text-blue-700' },
  score:    { label: 'Score', color: 'bg-amber-100 text-amber-700' },
  brief:    { label: 'Brief', color: 'bg-purple-100 text-purple-700' },
  audit:    { label: 'Audit', color: 'bg-emerald-100 text-emerald-700' },
};

function isScoreOnly(stepsToRun: string[]): boolean {
  return !stepsToRun.includes('brief');
}

function getStepLabel(step: string, scoreOnly: boolean): string {
  if (step === 'audit' && scoreOnly) return 'Quality Check';
  return STEP_CONFIG[step]?.label || step;
}

// ── Component ────────────────────────────────────────────────────

export function ResumeModal({ analysis, run, onConfirm, onCancel, resuming }: ResumeModalProps) {
  const [showLeads, setShowLeads] = useState(false);
  const [showRawError, setShowRawError] = useState(false);

  const { resume_plan: plan, leads_by_stage, total_leads } = analysis;
  const incomplete = total_leads - plan.leads_already_complete;
  const scoreOnly = isScoreOnly(plan.steps_to_run);
  const errorInfo = classifyError(run.error_message, run.status);
  const ErrorIcon = errorInfo.icon;

  const stageEntries = Object.entries(leads_by_stage).sort(
    (a, b) => (Object.keys(STAGE_CONFIG).indexOf(a[0])) - (Object.keys(STAGE_CONFIG).indexOf(b[0]))
  );

  const incompleteLeads = plan.lead_details.filter(l => l.pipeline_stage !== 'audited');
  const completeLeads = plan.lead_details.filter(l => l.pipeline_stage === 'audited');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between p-5 pb-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
              <PlayCircle className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Resume Run</h3>
              {run.campaign_name && (
                <p className="text-xs text-gray-500">{run.campaign_name}</p>
              )}
            </div>
          </div>
          <button onClick={onCancel} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {/* Error Context */}
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-start gap-2.5">
              <ErrorIcon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${errorInfo.color}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{errorInfo.headline}</p>
                <p className="text-xs text-gray-600 mt-0.5">{errorInfo.advice}</p>
                {run.error_message && (
                  <button
                    onClick={() => setShowRawError(!showRawError)}
                    className="text-[10px] text-gray-400 hover:text-gray-600 mt-1 flex items-center gap-1"
                  >
                    {showRawError ? 'Hide' : 'Show'} details
                    {showRawError ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                )}
                {showRawError && run.error_message && (
                  <p className="text-[10px] text-gray-400 mt-1 font-mono break-all leading-relaxed max-h-20 overflow-y-auto">
                    {run.error_message}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Pipeline Visualization */}
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Lead Progress</p>
            <div className="flex rounded-lg overflow-hidden h-8 bg-gray-100">
              {stageEntries.map(([stage, count]) => {
                const config = STAGE_CONFIG[stage] || { label: stage, color: 'text-gray-600', bg: 'bg-gray-200' };
                const pct = total_leads > 0 ? (count / total_leads) * 100 : 0;
                if (pct < 1) return null;
                return (
                  <div
                    key={stage}
                    className={`${config.bg} flex items-center justify-center min-w-[40px] transition-all`}
                    style={{ width: `${pct}%` }}
                    title={`${count} ${config.label}`}
                  >
                    <span className={`text-[10px] font-medium ${config.color} truncate px-1`}>
                      {count} {config.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Summary */}
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-sm text-gray-700">
              <span className="font-medium text-gray-900">{plan.leads_already_complete}</span> of{' '}
              <span className="font-medium text-gray-900">{total_leads}</span> leads already finished.
              Resume will process{' '}
              <span className="font-medium text-gray-900">{incomplete}</span> remaining lead{incomplete !== 1 ? 's' : ''}.
            </p>
          </div>

          {/* Steps to Run */}
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Steps to Run</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {plan.steps_to_run.map((step, i) => {
                const config = STEP_CONFIG[step] || { label: step, color: 'bg-gray-100 text-gray-600' };
                return (
                  <div key={step} className="flex items-center gap-1.5">
                    <span className={`px-2.5 py-1 rounded-md text-xs font-medium ${config.color}`}>
                      {getStepLabel(step, scoreOnly)}
                    </span>
                    {i < plan.steps_to_run.length - 1 && (
                      <span className="text-gray-300 text-xs">→</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Score-Only Banner */}
          {scoreOnly && (
            <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
              <p className="text-xs text-blue-700">
                Score-Only Mode — no outreach briefs will be generated
              </p>
            </div>
          )}

          {/* Lead Preview */}
          {plan.lead_details.length > 0 && (
            <div>
              <button
                onClick={() => setShowLeads(!showLeads)}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 uppercase tracking-wide"
              >
                {showLeads ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                {incomplete} lead{incomplete !== 1 ? 's' : ''} to process
              </button>
              {showLeads && (
                <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-gray-200">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-1.5 font-medium text-gray-500">Company</th>
                        <th className="text-left px-3 py-1.5 font-medium text-gray-500">Stage</th>
                        <th className="text-right px-3 py-1.5 font-medium text-gray-500">Score</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {incompleteLeads.map(lead => {
                        const stageConf = STAGE_CONFIG[lead.pipeline_stage] || { label: lead.pipeline_stage, color: 'text-gray-600', bg: 'bg-gray-100' };
                        return (
                          <tr key={lead.id}>
                            <td className="px-3 py-1.5">
                              <p className="font-medium text-gray-800 truncate max-w-[180px]">{lead.company_name}</p>
                              <p className="text-gray-400 truncate max-w-[180px]">{lead.domain}</p>
                            </td>
                            <td className="px-3 py-1.5">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${stageConf.bg} ${stageConf.color}`}>
                                {stageConf.label}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 text-right text-gray-600">
                              {lead.fit_score ? `${lead.fit_score}/100` : '—'}
                            </td>
                          </tr>
                        );
                      })}
                      {completeLeads.length > 0 && (
                        <tr>
                          <td colSpan={3} className="px-3 py-1.5 text-gray-400 italic">
                            {completeLeads.length} lead{completeLeads.length !== 1 ? 's' : ''} already complete
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-5 pt-3 border-t border-gray-100">
          <button
            onClick={onCancel}
            disabled={resuming}
            className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={resuming}
            className="px-4 py-2 text-sm text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
          >
            {resuming ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Resuming...
              </>
            ) : (
              <>
                <PlayCircle className="w-4 h-4" />
                Resume {incomplete} Lead{incomplete !== 1 ? 's' : ''}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export { classifyError };
export type { ResumeAnalysis, ErrorClassification };
