import { useState, useEffect, useRef } from 'react';
import { api } from '../api/client';
import { formatDate } from '../utils/dates';
import { Clock, History, ChevronDown, ChevronUp } from 'lucide-react';
import { useToast } from './Toast';

interface FeedbackPanelProps {
  leadId: string;
  companyName: string;
  feedbackList: any[];
  onFeedbackSubmitted: () => void;
}

const PRIMARY_VERDICTS = [
  { value: 'good_fit_booked', label: 'Booked', color: 'bg-blue-600 hover:bg-blue-700', icon: '★' },
  { value: 'good_fit_response', label: 'Response', color: 'bg-green-600 hover:bg-green-700', icon: '✓' },
  { value: 'good_fit_no_response', label: 'No Response', color: 'bg-gray-500 hover:bg-gray-600', icon: '—' },
];

const SECONDARY_VERDICTS = [
  { value: 'bad_fit', label: 'Bad Fit', color: 'bg-red-600 hover:bg-red-700', icon: '✕' },
  { value: 'good_fit_try_again', label: 'Try Later', color: 'bg-amber-600 hover:bg-amber-700', icon: '↻' },
];

const MORE_VERDICTS = [
  { value: 'closed_won', label: 'Closed Won', color: 'bg-emerald-600 hover:bg-emerald-700', icon: '🏆' },
  { value: 'closed_lost', label: 'Closed Lost', color: 'bg-rose-600 hover:bg-rose-700', icon: '✘' },
  { value: 'existing_customer', label: 'Already Customer', color: 'bg-purple-600 hover:bg-purple-700', icon: '🏢' },
  { value: 'stalled', label: 'Stalled', color: 'bg-slate-500 hover:bg-slate-600', icon: '⏸' },
  { value: 'nurture', label: 'Nurture', color: 'bg-sky-500 hover:bg-sky-600', icon: '🌱' },
];

const ALL_VERDICT_LABELS: Record<string, string> = {
  bad_fit: 'Bad Fit', good_fit_response: 'Response', good_fit_booked: 'Booked',
  good_fit_try_again: 'Try Later', good_fit_no_response: 'No Response',
  closed_won: 'Closed Won', closed_lost: 'Closed Lost', existing_customer: 'Already Customer',
  stalled: 'Stalled', nurture: 'Nurture', good_fit: 'Good Fit', not_fit: 'Not a Fit',
};

const VERDICT_COLORS: Record<string, string> = {
  bad_fit: 'bg-red-50 text-red-700 border-red-200',
  good_fit_response: 'bg-green-50 text-green-700 border-green-200',
  good_fit_booked: 'bg-blue-50 text-blue-700 border-blue-200',
  good_fit_try_again: 'bg-amber-50 text-amber-700 border-amber-200',
  good_fit_no_response: 'bg-gray-100 text-gray-600 border-gray-200',
  closed_won: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  closed_lost: 'bg-rose-50 text-rose-700 border-rose-200',
  existing_customer: 'bg-purple-50 text-purple-700 border-purple-200',
  stalled: 'bg-slate-50 text-slate-700 border-slate-200',
  nurture: 'bg-sky-50 text-sky-700 border-sky-200',
  good_fit: 'bg-green-50 text-green-700 border-green-200',
  not_fit: 'bg-red-50 text-red-700 border-red-200',
};

const BAD_FIT_REASONS = [
  { value: 'wrong_segment', label: 'Wrong Segment' },
  { value: 'too_small', label: 'Too Small' },
  { value: 'too_large', label: 'Too Large' },
  { value: 'wrong_vertical', label: 'Wrong Vertical' },
  { value: 'wrong_geo', label: 'Wrong Geo' },
  { value: 'no_budget', label: 'No Budget' },
  { value: 'wrong_product_fit', label: 'Wrong Product Fit' },
  { value: 'is_competitor', label: 'Is Competitor' },
  { value: 'other', label: 'Other' },
];

const LOSS_REASONS = [
  { value: 'price', label: 'Price' },
  { value: 'feature_gap', label: 'Feature Gap' },
  { value: 'competitor_relationship', label: 'Competitor Relationship' },
  { value: 'timing', label: 'Timing' },
  { value: 'no_decision', label: 'No Decision' },
  { value: 'champion_left', label: 'Champion Left' },
  { value: 'procurement_block', label: 'Procurement Block' },
  { value: 'other', label: 'Other' },
];

const CHANNELS = [
  { value: 'email', label: 'Email' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'cold_call', label: 'Cold Call' },
  { value: 'referral', label: 'Referral' },
  { value: 'event', label: 'Event' },
  { value: 'inbound', label: 'Inbound' },
];

const PERSONA_ROLES = [
  { value: 'champion', label: 'Champion' },
  { value: 'economic_buyer', label: 'Economic Buyer' },
  { value: 'executive_sponsor', label: 'Executive Sponsor' },
];

const STALLED_STAGES = [
  { value: 'initial_outreach', label: 'Initial Outreach' },
  { value: 'after_first_meeting', label: 'After First Meeting' },
  { value: 'during_evaluation', label: 'During Evaluation' },
  { value: 'procurement', label: 'Procurement' },
];

function VerdictButton({ opt, selected, onSelect, disabled }: {
  opt: { value: string; label: string; color: string; icon: string };
  selected: string;
  onSelect: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={() => onSelect(opt.value)}
      disabled={disabled}
      className={`flex items-center justify-center gap-1 px-2 py-2 rounded-lg text-xs font-medium transition-colors ${
        selected === opt.value
          ? `${opt.color} text-white`
          : 'bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100'
      } disabled:opacity-50`}
    >
      <span>{opt.icon}</span>
      {opt.label}
    </button>
  );
}

function PillSelector({ options, value, onChange, multi = false, selected = [], onToggle }: {
  options: { value: string; label: string }[];
  value?: string;
  onChange?: (v: string) => void;
  multi?: boolean;
  selected?: string[];
  onToggle?: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(opt => {
        const isSelected = multi ? selected.includes(opt.value) : value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => multi ? onToggle?.(opt.value) : onChange?.(isSelected ? '' : opt.value)}
            type="button"
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              isSelected
                ? 'bg-brand-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export default function FeedbackPanel({ leadId, companyName, feedbackList, onFeedbackSubmitted }: FeedbackPanelProps) {
  const { showToast } = useToast();
  const [selectedVerdict, setSelectedVerdict] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [feedbackReason, setFeedbackReason] = useState('');
  const [retryDate, setRetryDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Outcome detail fields
  const [effectivePersona, setEffectivePersona] = useState('');
  const [effectiveChannel, setEffectiveChannel] = useState('');
  const [effectiveAngle, setEffectiveAngle] = useState('');
  const [dealValue, setDealValue] = useState('');
  const [competitorLostTo, setCompetitorLostTo] = useState('');
  const [lossReason, setLossReason] = useState('');
  const [badFitReasons, setBadFitReasons] = useState<string[]>([]);
  const [customerProducts, setCustomerProducts] = useState('');
  const [customerEnvironment, setCustomerEnvironment] = useState('');
  const [whyTheyBought, setWhyTheyBought] = useState('');
  const [stalledStage, setStalledStage] = useState('');

  const latestFeedback = feedbackList[0];
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current || !latestFeedback) return;
    initializedRef.current = true;

    setSelectedVerdict(latestFeedback.verdict || '');
    setFeedbackReason(latestFeedback.reason || '');
    setRetryDate(latestFeedback.retry_date || '');

    if (MORE_VERDICTS.some(v => v.value === latestFeedback.verdict)) {
      setShowMore(true);
    }

    if (latestFeedback.effective_persona) setEffectivePersona(latestFeedback.effective_persona);
    if (latestFeedback.effective_channel) setEffectiveChannel(latestFeedback.effective_channel);
    if (latestFeedback.effective_angle) setEffectiveAngle(latestFeedback.effective_angle);
    if (latestFeedback.deal_value) setDealValue(latestFeedback.deal_value);
    if (latestFeedback.competitor_lost_to) setCompetitorLostTo(latestFeedback.competitor_lost_to);
    if (latestFeedback.loss_reason) setLossReason(latestFeedback.loss_reason);
    if (latestFeedback.stalled_stage) setStalledStage(latestFeedback.stalled_stage);
    if (latestFeedback.bad_fit_reasons) {
      try {
        const parsed = typeof latestFeedback.bad_fit_reasons === 'string'
          ? JSON.parse(latestFeedback.bad_fit_reasons)
          : latestFeedback.bad_fit_reasons;
        if (Array.isArray(parsed)) setBadFitReasons(parsed);
      } catch {}
    }
  }, [latestFeedback]);

  useEffect(() => {
    initializedRef.current = false;
    resetForm();
  }, [leadId]);

  function selectVerdict(v: string) {
    setSelectedVerdict(selectedVerdict === v ? '' : v);
  }

  function resetForm() {
    setSelectedVerdict('');
    setFeedbackReason('');
    setRetryDate('');
    setShowMore(false);
    setEffectivePersona('');
    setEffectiveChannel('');
    setEffectiveAngle('');
    setDealValue('');
    setCompetitorLostTo('');
    setLossReason('');
    setBadFitReasons([]);
    setCustomerProducts('');
    setCustomerEnvironment('');
    setWhyTheyBought('');
    setStalledStage('');
  }

  async function submit() {
    if (!selectedVerdict) return;
    setLoading(true);
    try {
      const body: any = {
        verdict: selectedVerdict,
        reason: feedbackReason || undefined,
        retry_date: selectedVerdict === 'good_fit_try_again' ? retryDate || undefined : undefined,
      };

      const hasDetails = effectivePersona || effectiveChannel || effectiveAngle
        || dealValue || competitorLostTo || lossReason || badFitReasons.length
        || customerProducts || customerEnvironment || whyTheyBought || stalledStage;

      if (hasDetails) {
        body.outcome_details = {
          effective_persona: effectivePersona || undefined,
          effective_channel: effectiveChannel || undefined,
          effective_angle: effectiveAngle || undefined,
          deal_value: dealValue || undefined,
          competitor_lost_to: competitorLostTo || undefined,
          loss_reason: lossReason || undefined,
          bad_fit_reasons: badFitReasons.length > 0 ? badFitReasons : undefined,
          customer_products: customerProducts ? customerProducts.split(',').map(s => s.trim()).filter(Boolean) : undefined,
          customer_environment: customerEnvironment ? { notes: customerEnvironment } : undefined,
          why_they_bought: whyTheyBought || undefined,
          stalled_stage: stalledStage || undefined,
        };
      }

      const result = await api(`/leads/${leadId}/feedback`, {
        method: 'POST',
        body: JSON.stringify(body),
      }) as any;

      const verdictLabel = ALL_VERDICT_LABELS[selectedVerdict] || selectedVerdict;
      if (result.exclusion_added) {
        showToast('success', `Feedback saved — ${verdictLabel}`, `${result.exclusion_added} added to exclusion list`);
      } else if (result.analysis_triggered) {
        showToast('success', `Feedback saved — ${verdictLabel}`, 'AI insights analysis triggered');
      } else {
        showToast('success', `Feedback saved — ${verdictLabel}`);
      }

      resetForm();
      initializedRef.current = false;
      onFeedbackSubmitted();
    } catch (err: any) {
      showToast('error', 'Failed to save feedback', err?.message || 'Please try again');
    } finally {
      setLoading(false);
    }
  }

  function toggleBadFitReason(reason: string) {
    setBadFitReasons(prev =>
      prev.includes(reason) ? prev.filter(r => r !== reason) : [...prev, reason]
    );
  }

  const needsSubForm = ['bad_fit', 'good_fit_booked', 'closed_won', 'closed_lost', 'existing_customer', 'stalled', 'good_fit_try_again'].includes(selectedVerdict);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <h3 className="font-medium text-gray-900 mb-3">Feedback</h3>

      {latestFeedback && (
        <div className={`p-3 rounded-lg text-sm border mb-3 ${VERDICT_COLORS[latestFeedback.verdict] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
          <p className="font-medium">{ALL_VERDICT_LABELS[latestFeedback.verdict] || latestFeedback.verdict}</p>
          {latestFeedback.reason && <p className="text-xs mt-1 opacity-80">{latestFeedback.reason}</p>}
          {latestFeedback.retry_date && (
            <p className="text-xs mt-1 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Re-outreach: {formatDate(latestFeedback.retry_date)}
            </p>
          )}
        </div>
      )}

      <div className="space-y-3">
        {/* Primary verdicts */}
        <div className="grid grid-cols-3 gap-1.5">
          {PRIMARY_VERDICTS.map(opt => <VerdictButton key={opt.value} opt={opt} selected={selectedVerdict} onSelect={selectVerdict} disabled={loading} />)}
        </div>

        {/* Secondary verdicts */}
        <div className="grid grid-cols-3 gap-1.5">
          {SECONDARY_VERDICTS.map(opt => <VerdictButton key={opt.value} opt={opt} selected={selectedVerdict} onSelect={selectVerdict} disabled={loading} />)}
          <button
            onClick={() => {
              const hasMoreSelected = MORE_VERDICTS.some(v => v.value === selectedVerdict);
              if (!hasMoreSelected) setShowMore(!showMore);
            }}
            className={`flex items-center justify-center gap-1 px-2 py-2 rounded-lg text-xs font-medium transition-colors border border-gray-200 ${
              showMore ? 'bg-gray-100 text-gray-800' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
            }`}
          >
            More {showMore ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>

        {/* Expanded verdicts */}
        {(showMore || MORE_VERDICTS.some(v => v.value === selectedVerdict)) && (
          <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-gray-100">
            {MORE_VERDICTS.map(opt => <VerdictButton key={opt.value} opt={opt} selected={selectedVerdict} onSelect={selectVerdict} disabled={loading} />)}
          </div>
        )}

        {/* Contextual sub-forms */}
        {selectedVerdict === 'good_fit_booked' && (
          <div className="space-y-2 pt-2 border-t border-gray-100">
            <label className="block text-xs text-gray-500">Persona role that worked</label>
            <PillSelector options={PERSONA_ROLES} value={effectivePersona} onChange={setEffectivePersona} />
            <label className="block text-xs text-gray-500 pt-1">Channel</label>
            <PillSelector options={CHANNELS} value={effectiveChannel} onChange={setEffectiveChannel} />
            <input
              value={effectiveAngle}
              onChange={e => setEffectiveAngle(e.target.value)}
              placeholder="What angle worked? (optional)"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
          </div>
        )}

        {selectedVerdict === 'bad_fit' && (
          <div className="space-y-2 pt-2 border-t border-gray-100">
            <label className="block text-xs text-gray-500">Why is this a bad fit?</label>
            <PillSelector options={BAD_FIT_REASONS} multi selected={badFitReasons} onToggle={toggleBadFitReason} />
            {badFitReasons.includes('is_competitor') && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-xs text-red-700">
                This will add {companyName} to the exclusion list as a competitor.
              </div>
            )}
          </div>
        )}

        {selectedVerdict === 'closed_won' && (
          <div className="space-y-2 pt-2 border-t border-gray-100">
            <input
              value={dealValue}
              onChange={e => setDealValue(e.target.value)}
              placeholder="Deal value (e.g. $45K ARR)"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
            <label className="block text-xs text-gray-500">What persona role closed?</label>
            <PillSelector options={PERSONA_ROLES} value={effectivePersona} onChange={setEffectivePersona} />
            <label className="block text-xs text-gray-500 pt-1">Channel that worked</label>
            <PillSelector options={CHANNELS} value={effectiveChannel} onChange={setEffectiveChannel} />
            <input
              value={whyTheyBought}
              onChange={e => setWhyTheyBought(e.target.value)}
              placeholder="What resonated? Why did they buy?"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
            <input
              value={customerProducts}
              onChange={e => setCustomerProducts(e.target.value)}
              placeholder="Products purchased (comma-separated)"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
          </div>
        )}

        {selectedVerdict === 'closed_lost' && (
          <div className="space-y-2 pt-2 border-t border-gray-100">
            <input
              value={competitorLostTo}
              onChange={e => setCompetitorLostTo(e.target.value)}
              placeholder="Lost to (competitor name)"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
            <label className="block text-xs text-gray-500">Loss reason</label>
            <PillSelector options={LOSS_REASONS} value={lossReason} onChange={setLossReason} />
          </div>
        )}

        {selectedVerdict === 'existing_customer' && (
          <div className="space-y-2 pt-2 border-t border-gray-100">
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-2 text-xs text-purple-700">
              This will add {companyName} to the exclusion list automatically.
            </div>
            <input
              value={customerProducts}
              onChange={e => setCustomerProducts(e.target.value)}
              placeholder="Products they use (comma-separated)"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
            <textarea
              value={customerEnvironment}
              onChange={e => setCustomerEnvironment(e.target.value)}
              placeholder="Environment notes (tech stack, deployment details)"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none h-16"
            />
            <input
              value={whyTheyBought}
              onChange={e => setWhyTheyBought(e.target.value)}
              placeholder="Why did they originally buy?"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
          </div>
        )}

        {selectedVerdict === 'stalled' && (
          <div className="space-y-2 pt-2 border-t border-gray-100">
            <label className="block text-xs text-gray-500">Where did they stall?</label>
            <PillSelector options={STALLED_STAGES} value={stalledStage} onChange={setStalledStage} />
          </div>
        )}

        {selectedVerdict === 'good_fit_try_again' && (
          <div className="pt-2 border-t border-gray-100">
            <label className="block text-xs text-gray-500 mb-1">Next outreach date</label>
            <input
              type="date"
              value={retryDate}
              onChange={e => setRetryDate(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
          </div>
        )}

        {/* Reason + Submit */}
        {selectedVerdict && (
          <>
            <textarea
              value={feedbackReason}
              onChange={e => setFeedbackReason(e.target.value)}
              placeholder={needsSubForm ? 'Additional notes (optional)...' : 'Optional reason...'}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none h-16 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            {selectedVerdict === 'closed_won' && (
              <p className="text-xs text-emerald-600">This will add {companyName} to the exclusion list.</p>
            )}
            <button
              onClick={submit}
              disabled={loading}
              className="w-full px-3 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
            >
              {loading ? 'Saving...' : latestFeedback ? 'Update Feedback' : 'Submit Feedback'}
            </button>
          </>
        )}
      </div>

      {/* Feedback history */}
      {feedbackList.length > 1 && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
          >
            <History className="w-3 h-3" />
            {showHistory ? 'Hide' : 'Show'} history ({feedbackList.length})
          </button>
          {showHistory && (
            <div className="mt-2 space-y-2">
              {feedbackList.map((f: any, i: number) => {
                const chips: string[] = [];
                if (f.effective_persona) chips.push(f.effective_persona === 'champion' ? 'Champion' : f.effective_persona === 'economic_buyer' ? 'Economic Buyer' : 'Exec Sponsor');
                if (f.effective_channel) chips.push(f.effective_channel.charAt(0).toUpperCase() + f.effective_channel.slice(1));
                if (f.deal_value) chips.push(f.deal_value);
                if (f.competitor_lost_to) chips.push(`Lost to ${f.competitor_lost_to}`);
                if (f.loss_reason) chips.push(LOSS_REASONS.find(r => r.value === f.loss_reason)?.label || f.loss_reason);
                if (f.stalled_stage) chips.push(STALLED_STAGES.find(s => s.value === f.stalled_stage)?.label || f.stalled_stage);
                if (f.bad_fit_reasons) {
                  try {
                    const reasons: string[] = typeof f.bad_fit_reasons === 'string' ? JSON.parse(f.bad_fit_reasons) : f.bad_fit_reasons;
                    for (const r of reasons.slice(0, 2)) {
                      const label = BAD_FIT_REASONS.find(b => b.value === r)?.label;
                      if (label) chips.push(label);
                    }
                  } catch {}
                }

                return (
                  <div key={f.id || i} className="flex items-start gap-2 text-xs">
                    <div className={`w-2 h-2 rounded-full mt-1 flex-shrink-0 ${
                      f.verdict.includes('good_fit') || f.verdict === 'closed_won' ? 'bg-green-500'
                      : f.verdict === 'existing_customer' ? 'bg-purple-500'
                      : f.verdict === 'stalled' || f.verdict === 'nurture' ? 'bg-slate-400'
                      : 'bg-red-500'
                    }`} />
                    <div>
                      <span className="font-medium text-gray-700">{ALL_VERDICT_LABELS[f.verdict] || f.verdict}</span>
                      {f.reason && <span className="text-gray-500"> — {f.reason}</span>}
                      {chips.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {chips.map((chip, ci) => (
                            <span key={ci} className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px]">{chip}</span>
                          ))}
                        </div>
                      )}
                      {f.created_at && <p className="text-gray-400 mt-0.5">{formatDate(f.created_at)}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
