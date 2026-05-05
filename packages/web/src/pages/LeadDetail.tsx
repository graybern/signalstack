import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { formatDate } from '../utils/dates';
import { ScoreBadge, ScoreLabel, ConfidenceBadge, SegmentBadge } from '../components/ScoreBadge';
import {
  ArrowLeft, ExternalLink, Building2, Users, MapPin, Globe, Calendar,
  Briefcase, Linkedin, MessageSquare, Shield, Server, ChevronDown, ChevronUp,
  Signal, Clock, History, Trash2, AlertTriangle, Brain, FileText, Download,
} from 'lucide-react';

const VERDICT_OPTIONS = [
  { value: 'bad_fit', label: 'Bad Fit', color: 'bg-red-600 hover:bg-red-700', icon: '✕' },
  { value: 'good_fit_response', label: 'Response', color: 'bg-green-600 hover:bg-green-700', icon: '✓' },
  { value: 'good_fit_booked', label: 'Booked', color: 'bg-blue-600 hover:bg-blue-700', icon: '★' },
  { value: 'good_fit_try_again', label: 'Try Again', color: 'bg-amber-600 hover:bg-amber-700', icon: '↻' },
  { value: 'good_fit_no_response', label: 'No Response', color: 'bg-gray-500 hover:bg-gray-600', icon: '—' },
];

const FEEDBACK_COLORS: Record<string, string> = {
  bad_fit: 'bg-red-50 text-red-700 border-red-200',
  good_fit_response: 'bg-green-50 text-green-700 border-green-200',
  good_fit_booked: 'bg-blue-50 text-blue-700 border-blue-200',
  good_fit_try_again: 'bg-amber-50 text-amber-700 border-amber-200',
  good_fit_no_response: 'bg-gray-100 text-gray-600 border-gray-200',
  good_fit: 'bg-green-50 text-green-700 border-green-200',
  not_fit: 'bg-red-50 text-red-700 border-red-200',
};

const FEEDBACK_LABELS: Record<string, string> = {
  bad_fit: 'Bad Fit',
  good_fit_response: 'Response',
  good_fit_booked: 'Booked',
  good_fit_try_again: 'Try Again',
  good_fit_no_response: 'No Response',
  good_fit: 'Good Fit',
  not_fit: 'Bad Fit',
};

export function LeadDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [lead, setLead] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackReason, setFeedbackReason] = useState('');
  const [retryDate, setRetryDate] = useState('');
  const [selectedVerdict, setSelectedVerdict] = useState('');
  const [expandedPersona, setExpandedPersona] = useState<number>(0);
  const [showFeedbackHistory, setShowFeedbackHistory] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showBriefMenu, setShowBriefMenu] = useState(false);
  const briefMenuRef = useRef<HTMLDivElement>(null);

  const handleDeleteLead = async () => {
    setDeleting(true);
    try {
      await api(`/leads/${id}`, { method: 'DELETE' });
      navigate('/leads');
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setDeleting(false);
    }
  };

  const handleDownloadBrief = async (format: 'markdown' | 'pdf') => {
    if (!lead?.brief_markdown) return;
    setShowBriefMenu(false);
    if (format === 'markdown') {
      const slug = lead.company_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const blob = new Blob([lead.brief_markdown], { type: 'text/markdown' });
      downloadBlob(blob, `${slug}-brief.md`);
    } else {
      const { openBriefPrintWindow } = await import('../utils/markdownToPdf');
      openBriefPrintWindow([{
        markdown: lead.brief_markdown,
        company_name: lead.company_name,
        fit_score: lead.fit_score,
        segment: lead.segment,
      }]);
    }
  };

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (briefMenuRef.current && !briefMenuRef.current.contains(e.target as Node)) {
        setShowBriefMenu(false);
      }
    }
    if (showBriefMenu) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showBriefMenu]);

  useEffect(() => {
    api(`/leads/${id}`).then(setLead).finally(() => setLoading(false));
  }, [id]);

  async function submitFeedback() {
    if (!selectedVerdict) return;
    setFeedbackLoading(true);
    try {
      await api(`/leads/${id}/feedback`, {
        method: 'POST',
        body: JSON.stringify({
          verdict: selectedVerdict,
          reason: feedbackReason || undefined,
          retry_date: selectedVerdict === 'good_fit_try_again' ? retryDate || undefined : undefined,
        }),
      });
      const updated = await api(`/leads/${id}`);
      setLead(updated);
      setFeedbackReason('');
      setRetryDate('');
      setSelectedVerdict('');
    } finally {
      setFeedbackLoading(false);
    }
  }

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500" /></div>;
  if (!lead) return <div className="text-center py-12 text-gray-500">Lead not found</div>;

  const painHypotheses = lead.pain_hypotheses_parsed || [];
  const whyNow = lead.why_now_parsed || [];
  const techStack = lead.tech_stack_parsed;
  const competitive = lead.competitive_displacement_parsed;
  const scoreBreakdown = lead.score_breakdown_parsed;
  const sources = lead.sources_parsed || [];
  const outreach = lead.outreach_strategy_parsed;
  const feedbackList: any[] = lead.feedback || [];
  const latestFeedback = feedbackList[0];
  const signalCount = lead.signal_count || 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Link to="/leads" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="w-4 h-4" /> Back to Leads
        </Link>
        <div className="flex items-center gap-2">
          {lead?.brief_markdown && (
            <div className="relative" ref={briefMenuRef}>
              <button
                onClick={() => setShowBriefMenu(!showBriefMenu)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                <FileText className="w-3.5 h-3.5" />
                Download Brief
                <ChevronDown className="w-3 h-3" />
              </button>
              {showBriefMenu && (
                <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
                  <button
                    onClick={() => handleDownloadBrief('markdown')}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3"
                  >
                    <FileText className="w-4 h-4 text-gray-400" />
                    <div>
                      <p className="font-medium">Markdown</p>
                      <p className="text-xs text-gray-400">.md file</p>
                    </div>
                  </button>
                  <button
                    onClick={() => handleDownloadBrief('pdf')}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3 border-t border-gray-100"
                  >
                    <Download className="w-4 h-4 text-brand-500" />
                    <div>
                      <p className="font-medium">PDF</p>
                      <p className="text-xs text-gray-400">Styled brief</p>
                    </div>
                  </button>
                </div>
              )}
            </div>
          )}
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
        </div>
      </div>

      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-4">
        <div className="flex items-start gap-4">
          <ScoreBadge score={lead.fit_score} size="lg" />
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold">{lead.company_name}</h1>
              <SegmentBadge segment={lead.segment} />
              <ConfidenceBadge confidence={lead.confidence || 'medium'} />
              {signalCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                  <Signal className="w-3 h-3" />
                  {signalCount} signals
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 text-sm text-gray-500">
              <ScoreLabel score={lead.fit_score} />
              <span className="mx-1">&middot;</span>
              <span>{lead.fit_score}/100</span>
            </div>
            <div className="flex flex-wrap gap-4 mt-3 text-sm text-gray-600">
              {lead.hq_location && <span className="flex items-center gap-1"><MapPin className="w-4 h-4" />{lead.hq_location}</span>}
              {lead.employee_count && <span className="flex items-center gap-1"><Users className="w-4 h-4" />~{lead.employee_count.toLocaleString()} employees</span>}
              {lead.founded_year && <span className="flex items-center gap-1"><Calendar className="w-4 h-4" />Founded {lead.founded_year}</span>}
              {lead.funding_stage && <span className="flex items-center gap-1"><Building2 className="w-4 h-4" />{lead.funding_stage} {lead.total_funding && `(${lead.total_funding})`}</span>}
              {lead.website && <a href={lead.website} target="_blank" rel="noopener" className="flex items-center gap-1 text-brand-600 hover:underline"><Globe className="w-4 h-4" />{lead.website}</a>}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-4">
          {/* Why Now */}
          {whyNow.length > 0 && (
            <Section title="Why Now" icon={<Briefcase className="w-4 h-4" />}>
              <ul className="space-y-2">
                {whyNow.map((trigger: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-500 mt-1.5 flex-shrink-0" />
                    {trigger}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Pain Hypotheses */}
          {painHypotheses.length > 0 && (
            <Section title="Pain Hypotheses" icon={<Shield className="w-4 h-4" />}>
              <div className="space-y-3">
                {painHypotheses.map((p: any, i: number) => (
                  <div key={i} className="border-l-2 border-brand-200 pl-3">
                    <p className="text-sm font-medium text-gray-900">{p.claim || p}</p>
                    {p.why_it_matters && <p className="text-sm text-gray-600 mt-0.5">{p.why_it_matters}</p>}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Target Personas */}
          {lead.personas?.length > 0 && (
            <Section title="Target Personas" icon={<Users className="w-4 h-4" />}>
              <div className="space-y-3">
                {lead.personas.map((p: any, i: number) => (
                  <div key={p.id} className="border border-gray-200 rounded-lg">
                    <button
                      onClick={() => setExpandedPersona(expandedPersona === i ? -1 : i)}
                      className="w-full flex items-center justify-between p-4 text-left"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 text-sm font-bold">
                          {(p.name || '?')[0]}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{p.name || 'Unknown'}</p>
                          <p className="text-xs text-gray-500">{p.title} &middot; <span className="capitalize">{p.role_type?.replace('_', ' ')}</span></p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {p.linkedin_url && (
                          <a href={p.linkedin_url} target="_blank" rel="noopener" onClick={e => e.stopPropagation()} className="text-blue-600 hover:text-blue-800">
                            <Linkedin className="w-4 h-4" />
                          </a>
                        )}
                        {expandedPersona === i ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                      </div>
                    </button>
                    {expandedPersona === i && (
                      <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
                        {p.outreach_angle && (
                          <div>
                            <p className="text-xs font-medium text-gray-500 uppercase mb-1">Outreach Angle</p>
                            <p className="text-sm text-gray-700">{p.outreach_angle}</p>
                          </div>
                        )}
                        {(p.talking_points_parsed || []).length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-gray-500 uppercase mb-1">Talking Points</p>
                            <ul className="space-y-1">
                              {(p.talking_points_parsed || []).map((tp: string, j: number) => (
                                <li key={j} className="text-sm text-gray-700 flex items-start gap-2">
                                  <MessageSquare className="w-3 h-3 mt-1 text-brand-400 flex-shrink-0" />{tp}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {p.outreach_message && (
                          <div>
                            <p className="text-xs font-medium text-gray-500 uppercase mb-1">Draft Outreach Message</p>
                            <blockquote className="text-sm text-gray-700 bg-gray-50 p-3 rounded-lg border-l-2 border-brand-300 italic">
                              {p.outreach_message}
                            </blockquote>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Competitive Displacement */}
          {competitive && (
            <Section title="Competitive Displacement" icon={<Shield className="w-4 h-4" />}>
              {competitive.likely_current?.length > 0 && (
                <div className="mb-2">
                  <p className="text-xs font-medium text-gray-500 uppercase mb-1">Likely Current Solution</p>
                  <div className="flex flex-wrap gap-1">
                    {competitive.likely_current.map((c: string, i: number) => (
                      <span key={i} className="px-2 py-1 bg-red-50 text-red-700 rounded text-xs">{c}</span>
                    ))}
                  </div>
                </div>
              )}
              {competitive.twingate_wedge?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase mb-1">Competitive Advantage</p>
                  <div className="flex flex-wrap gap-1">
                    {competitive.twingate_wedge.map((w: string, i: number) => (
                      <span key={i} className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded text-xs">{w}</span>
                    ))}
                  </div>
                </div>
              )}
            </Section>
          )}

          {/* Sources */}
          {sources.length > 0 && (
            <Section title={`Sources (${sources.length})`} icon={<ExternalLink className="w-4 h-4" />}>
              <div className="space-y-1">
                {sources.map((s: any, i: number) => (
                  <a key={i} href={s.url} target="_blank" rel="noopener" className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                    <span className="text-xs text-gray-400">[{i + 1}]</span>
                    <span className="truncate">{s.label || s.url}</span>
                    <span className="text-xs text-gray-400">({s.type})</span>
                  </a>
                ))}
              </div>
            </Section>
          )}

          {/* AI Reasoning */}
          {(lead.scorer_thinking || lead.brief_thinking || lead.candidate_data_parsed?.reasoning) && (
            <AIReasoningSection
              scorerThinking={lead.scorer_thinking}
              briefThinking={lead.brief_thinking}
              reasoning={lead.candidate_data_parsed?.reasoning}
            />
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Feedback */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="font-medium text-gray-900 mb-3">Feedback</h3>

            {/* Current feedback status */}
            {latestFeedback && (
              <div className={`p-3 rounded-lg text-sm border mb-3 ${FEEDBACK_COLORS[latestFeedback.verdict] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                <p className="font-medium">{FEEDBACK_LABELS[latestFeedback.verdict] || latestFeedback.verdict}</p>
                {latestFeedback.reason && <p className="text-xs mt-1 opacity-80">{latestFeedback.reason}</p>}
                {latestFeedback.retry_date && (
                  <p className="text-xs mt-1 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Re-outreach: {formatDate(latestFeedback.retry_date)}
                  </p>
                )}
              </div>
            )}

            {/* Verdict selector */}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-1.5">
                {VERDICT_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setSelectedVerdict(selectedVerdict === opt.value ? '' : opt.value)}
                    disabled={feedbackLoading}
                    className={`flex items-center justify-center gap-1 px-2 py-2 rounded-lg text-xs font-medium transition-colors ${
                      selectedVerdict === opt.value
                        ? `${opt.color} text-white`
                        : 'bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100'
                    } disabled:opacity-50`}
                  >
                    <span>{opt.icon}</span>
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Retry date picker for Try Again */}
              {selectedVerdict === 'good_fit_try_again' && (
                <div>
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

              {selectedVerdict && (
                <>
                  <textarea
                    value={feedbackReason}
                    onChange={e => setFeedbackReason(e.target.value)}
                    placeholder="Optional reason..."
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none h-16 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <button
                    onClick={submitFeedback}
                    disabled={feedbackLoading}
                    className="w-full px-3 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                  >
                    {feedbackLoading ? 'Saving...' : latestFeedback ? 'Update Feedback' : 'Submit Feedback'}
                  </button>
                </>
              )}
            </div>

            {/* Feedback history */}
            {feedbackList.length > 1 && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <button
                  onClick={() => setShowFeedbackHistory(!showFeedbackHistory)}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
                >
                  <History className="w-3 h-3" />
                  {showFeedbackHistory ? 'Hide' : 'Show'} history ({feedbackList.length})
                </button>
                {showFeedbackHistory && (
                  <div className="mt-2 space-y-2">
                    {feedbackList.map((f: any, i: number) => (
                      <div key={f.id || i} className="flex items-start gap-2 text-xs">
                        <div className={`w-2 h-2 rounded-full mt-1 flex-shrink-0 ${
                          f.verdict.includes('good_fit') ? 'bg-green-500' : 'bg-red-500'
                        }`} />
                        <div>
                          <span className="font-medium text-gray-700">{FEEDBACK_LABELS[f.verdict] || f.verdict}</span>
                          {f.reason && <span className="text-gray-500"> — {f.reason}</span>}
                          {f.created_at && (
                            <p className="text-gray-400">{formatDate(f.created_at)}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Tech Stack */}
          {techStack && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="font-medium text-gray-900 mb-3 flex items-center gap-2"><Server className="w-4 h-4" /> Tech Stack Intel</h3>
              <div className="space-y-3 text-sm">
                {techStack.vpn_product && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase">VPN</p>
                    <p className="text-gray-900">{techStack.vpn_product.product} <ConfidenceBadge confidence={techStack.vpn_product.confidence} /></p>
                  </div>
                )}
                {techStack.pam_product && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase">PAM</p>
                    <p className="text-gray-900">{techStack.pam_product.product} <ConfidenceBadge confidence={techStack.pam_product.confidence} /></p>
                  </div>
                )}
                {techStack.cloud_infra?.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Cloud</p>
                    <div className="flex flex-wrap gap-1">{techStack.cloud_infra.map((c: string) => <span key={c} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">{c}</span>)}</div>
                  </div>
                )}
                {techStack.dev_tools?.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Dev Tools</p>
                    <div className="flex flex-wrap gap-1">{techStack.dev_tools.map((t: string) => <span key={t} className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs">{t}</span>)}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Score Breakdown */}
          {scoreBreakdown && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="font-medium text-gray-900 mb-3">Score Breakdown</h3>
              <div className="space-y-2">
                <ScoreBar label="Segment Fit" value={scoreBreakdown.segment_scale_fit?.points || 0} max={20} />
                <ScoreBar label="Why Now" value={scoreBreakdown.why_now_triggers?.points || 0} max={15} />
                <ScoreBar label="Remote Access Pain" value={scoreBreakdown.remote_access_pain?.points || 0} max={20} />
                <ScoreBar label="Displacement Wedge" value={scoreBreakdown.displacement_wedge?.points || 0} max={20} />
                <ScoreBar label="Vertical Fit" value={scoreBreakdown.vertical_playbook?.points || 0} max={15} />
                <ScoreBar label="Buyer Access" value={scoreBreakdown.buyer_access_readiness?.points || 0} max={10} />
                {(scoreBreakdown.penalties || []).map((p: any, i: number) => (
                  <div key={i} className="text-xs text-red-600">Penalty: {p.points} — {p.reason}</div>
                ))}
                <div className="border-t pt-2 flex justify-between font-bold text-sm">
                  <span>Total</span>
                  <span>{scoreBreakdown.total || lead.fit_score}/100</span>
                </div>
              </div>
            </div>
          )}

          {/* Outreach Strategy */}
          {outreach && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="font-medium text-gray-900 mb-3">Outreach Strategy</h3>
              {outreach.sequence && (
                <ol className="space-y-2 text-sm text-gray-700">
                  {outreach.sequence.map((step: string, i: number) => (
                    <li key={i} className="flex gap-2">
                      <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-xs flex items-center justify-center flex-shrink-0">{i + 1}</span>
                      {step}
                    </li>
                  ))}
                </ol>
              )}
              {outreach.one_line_pitch && (
                <p className="mt-3 text-sm italic text-gray-600 border-l-2 border-brand-200 pl-2">{outreach.one_line_pitch}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Delete Lead</h3>
                <p className="text-sm text-gray-500">This action cannot be undone</p>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-6">
              Are you sure you want to delete "{lead.company_name}"? All associated personas and feedback will be removed.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteLead}
                disabled={deleting}
                className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3 flex items-center gap-2">{icon}{title}</h2>
      {children}
    </div>
  );
}

function ScoreBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-28 text-gray-600 truncate">{label}</span>
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full bg-brand-500 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 text-right text-gray-500">{value}/{max}</span>
    </div>
  );
}

function AIReasoningSection({ scorerThinking, briefThinking, reasoning }: { scorerThinking?: string; briefThinking?: string; reasoning?: string }) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const sections = [
    { key: 'scoring', label: 'Scoring Reasoning', content: scorerThinking || reasoning, color: 'border-amber-300 bg-amber-50' },
    { key: 'brief', label: 'Brief Generation Reasoning', content: briefThinking, color: 'border-purple-300 bg-purple-50' },
  ].filter(s => s.content);

  if (sections.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3 flex items-center gap-2">
        <Brain className="w-4 h-4" />
        AI Reasoning
      </h2>
      <p className="text-xs text-gray-500 mb-3">
        Claude's internal reasoning during scoring and brief generation for this candidate.
      </p>
      <div className="space-y-2">
        {sections.map(section => (
          <div key={section.key} className="border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setExpandedSection(expandedSection === section.key ? null : section.key)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
            >
              <span className="text-sm font-medium text-gray-700">{section.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">
                  {(section.content?.length || 0).toLocaleString()} chars
                </span>
                {expandedSection === section.key ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </div>
            </button>
            {expandedSection === section.key && (
              <div className={`px-4 py-3 border-t ${section.color} max-h-96 overflow-y-auto`}>
                <pre className="text-xs text-gray-800 whitespace-pre-wrap font-mono leading-relaxed">
                  {section.content}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
