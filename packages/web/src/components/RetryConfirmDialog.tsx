import { useState } from 'react';
import { X, RefreshCw, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { classifyError } from './ResumeModal';

interface RetryConfirmDialogProps {
  analysis: {
    total_leads: number;
    resume_plan?: {
      steps_to_run: string[];
      lead_ids: string[];
      leads_already_complete: number;
      estimated_work: string;
    };
  };
  mode: 'resume' | 'rerun';
  rerunCount?: number;
  errorMessage?: string | null;
  status?: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirming: boolean;
}

const STEP_FRIENDLY: Record<string, string> = {
  enrich: 'Enrich',
  score: 'Score',
  brief: 'Brief',
  audit: 'Quality Check',
  discover: 'Discover',
  qualify: 'Qualify',
};

export function RetryConfirmDialog({ analysis, mode, rerunCount, errorMessage, status, onConfirm, onCancel, confirming }: RetryConfirmDialogProps) {
  const [showDetails, setShowDetails] = useState(false);
  const classified = classifyError(errorMessage, status);
  const ErrorIcon = classified.icon;

  const isRerun = mode === 'rerun';
  const total = isRerun ? (rerunCount || 0) : analysis.total_leads;
  const finished = isRerun ? 0 : (analysis.resume_plan?.leads_already_complete || 0);
  const remaining = isRerun ? total : (analysis.resume_plan?.lead_ids.length || 0);
  const steps = analysis.resume_plan?.steps_to_run || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-start gap-3 px-6 pt-6 pb-4">
          <div className={`p-2 rounded-xl bg-gray-50 ${classified.color}`}>
            <ErrorIcon className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-gray-900">{classified.headline}</h3>
            <p className="text-sm text-gray-500 mt-0.5">{classified.advice}</p>
          </div>
          <button onClick={onCancel} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Progress summary */}
        <div className="px-6 pb-4">
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-gray-600">
                <span className="font-semibold text-gray-900">{finished}</span> of {total} companies finished
              </span>
              <span className="text-xs font-medium text-amber-600">{remaining} to {isRerun ? 'rerun' : 'retry'}</span>
            </div>
            <div className="mt-2 bg-gray-200 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all"
                style={{ width: `${total > 0 ? Math.round((finished / total) * 100) : 0}%` }}
              />
            </div>
          </div>
        </div>

        {/* Technical details (collapsed) */}
        <div className="px-6 pb-4">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Technical details
          </button>
          {showDetails && (
            <div className="mt-2 text-xs text-gray-500 space-y-1.5 pl-4 border-l-2 border-gray-100">
              {steps.length > 0 && (
                <p><span className="font-medium text-gray-600">Steps:</span> {steps.map(s => STEP_FRIENDLY[s] || s).join(' → ')}</p>
              )}
              <p><span className="font-medium text-gray-600">Companies:</span> {remaining}</p>
              <p><span className="font-medium text-gray-600">Mode:</span> {isRerun ? 'Fresh rerun (start from scratch)' : 'Resume from where it stopped'}</p>
              {errorMessage && (
                <p className="text-red-500/70 break-words"><span className="font-medium text-gray-600">Error:</span> {errorMessage}</p>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 px-6 py-4 bg-gray-50 border-t border-gray-100">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={confirming}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-green-600 rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {isRerun ? 'Rerun' : 'Retry'} {remaining} {remaining === 1 ? 'Company' : 'Companies'}
          </button>
        </div>
      </div>
    </div>
  );
}
