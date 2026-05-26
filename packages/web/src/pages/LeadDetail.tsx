import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthContext } from '../App';
import { permissions } from '../utils/permissions';
import { useEventStream } from '../hooks/useEventStream';
import { formatDate, formatDateTimeFull } from '../utils/dates';
import { ScoreBadge, ScoreLabel, ConfidenceBadge, SegmentBadge } from '../components/ScoreBadge';
import { renderInlineMarkdown } from '../utils/inlineMarkdown';
import {
  ArrowLeft, ExternalLink, Building2, Users, MapPin, Globe, Calendar,
  Briefcase, Linkedin, MessageSquare, Shield, Server, ChevronDown, ChevronUp,
  Signal, Trash2, AlertTriangle, Brain, FileText, Download, Layers,
  ClipboardCheck, RefreshCw, Sparkles, Check, Circle, XCircle, ArrowRight,
} from 'lucide-react';
import FeedbackPanel from '../components/FeedbackPanel';

export function LeadDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const [lead, setLead] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [rerunning, setRerunning] = useState(false);
  const [rerunStatus, setRerunStatus] = useState<string | null>(null);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [rerunStage, setRerunStage] = useState<string | null>(null);
  const [completedStages, setCompletedStages] = useState<Set<string>>(new Set());
  const [failedStage, setFailedStage] = useState<string | null>(null);
  const [rerunRunId, setRerunRunId] = useState<string | null>(null);
  const [rerunVisible, setRerunVisible] = useState(false);
  const [expandedPersona, setExpandedPersona] = useState<number>(-1);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showBriefMenu, setShowBriefMenu] = useState(false);
  const [expandedSignalCat, setExpandedSignalCat] = useState<string | null>(null);
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

  const fetchLead = useCallback(() => api(`/leads/${id}`).then(setLead), [id]);
  useEffect(() => {
    fetchLead().finally(() => setLoading(false));
  }, [id]);

  // SSE subscription for stage rerun progress
  const { subscribe } = useEventStream({ types: ['lead.brief_rerun', 'lead.stage_rerun'], enabled: rerunning });
  useEffect(() => {
    if (!rerunning) return;
    const unsubs: (() => void)[] = [];
    const handleStageEvent = (event: any) => {
      if (event.data?.lead_id !== id) return;
      const { status, message, stage, run_id } = event.data;
      if (run_id && !rerunRunId) setRerunRunId(run_id);
      if (stage) {
        if (status === 'processing') setRerunStage(stage);
        if (status === 'completed') {
          setCompletedStages(prev => new Set([...prev, stage]));
          setRerunStage(null);
        }
        if (status === 'failed') {
          setFailedStage(stage);
        }
      }
      setRerunStatus(message || status);
    };
    const handleBriefEvent = (event: any) => {
      if (event.data?.lead_id !== id) return;
      const { status, message } = event.data;
      setRerunStatus(message || status);
      if (status === 'completed') {
        fetchLead().finally(() => {
          setRerunning(false);
          setCompletedStages(new Set(['enrich', 'score', 'brief', 'audit']));
          setTimeout(() => setRerunVisible(false), 5000);
        });
      } else if (status === 'failed') {
        setRerunning(false);
        setRerunError(message || 'Rerun failed');
      }
    };
    unsubs.push(subscribe('lead.stage_rerun', handleStageEvent));
    unsubs.push(subscribe('lead.brief_rerun', handleBriefEvent));
    return () => unsubs.forEach(fn => fn());
  }, [rerunning, id, subscribe, fetchLead, rerunRunId]);

  const handleRerun = async () => {
    setRerunning(true);
    setRerunVisible(true);
    setRerunStatus('Starting rerun...');
    setRerunError(null);
    setRerunStage(null);
    setCompletedStages(new Set());
    setFailedStage(null);
    setRerunRunId(null);
    try {
      await api(`/leads/${id}/rerun-brief`, { method: 'POST' });
    } catch (err: any) {
      console.error('Rerun failed:', err);
      setRerunning(false);
      setRerunError(err?.message || 'Failed to start rerun');
    }
  };

  async function refreshLead() {
    try {
      const updated = await api(`/leads/${id}`);
      setLead(updated);
    } catch {}
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
  const signalCount = lead.signal_count || 0;

  function renderWithCitations(text: string) {
    if (!text) return null;
    const parts = text.split(/(\[\d+\])/g);
    if (parts.length === 1) return <>{renderInlineMarkdown(text)}</>;
    return (
      <>
        {parts.map((part, i) => {
          const match = part.match(/^\[(\d+)\]$/);
          if (!match) return <span key={i}>{renderInlineMarkdown(part)}</span>;
          const citationId = parseInt(match[1]);
          const source = sources.find((s: any) => (s.id ?? 0) === citationId) || sources[citationId - 1];
          return (
            <span key={i} className="relative group inline-block">
              <button
                onClick={() => document.getElementById(`source-${citationId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                className="inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 rounded cursor-pointer hover:bg-blue-100 align-super ml-0.5"
              >
                {citationId}
              </button>
              {source && (
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 whitespace-nowrap max-w-xs">
                  <span className="block font-medium truncate">{source.label || source.url}</span>
                  <span className="flex items-center gap-2 mt-0.5">
                    <span className="text-gray-400">{source.type}</span>
                    {source.confidence && (
                      <span className={`px-1 py-0.5 rounded text-[10px] font-medium ${
                        source.confidence === 'high' || source.confidence === 'confirmed' ? 'bg-green-900 text-green-300' :
                        source.confidence === 'medium' || source.confidence === 'inferred' ? 'bg-amber-900 text-amber-300' :
                        'bg-gray-700 text-gray-300'
                      }`}>
                        {source.confidence === 'confirmed' ? 'high' : source.confidence === 'inferred' ? 'medium' : source.confidence}
                      </span>
                    )}
                  </span>
                </span>
              )}
            </span>
          );
        })}
      </>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Link to="/leads" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="w-4 h-4" /> Back to Leads
        </Link>
        <div className="flex items-center gap-2">
          {permissions.canAccessSettings(user?.role) && lead?.campaign_id && (
            <button
              onClick={handleRerun}
              disabled={rerunning}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-lg disabled:opacity-50 transition-colors ${
                rerunError ? 'border-red-300 text-red-700 bg-red-50' :
                rerunning ? 'border-amber-300 text-amber-700 bg-amber-50' :
                'border-amber-300 text-amber-700 hover:bg-amber-50'
              }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${rerunning ? 'animate-spin' : ''}`} />
              {rerunError ? 'Failed' : rerunning ? 'Rerunning...' : 'Rerun'}
            </button>
          )}
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

      {/* Rerun Progress Bar */}
      {rerunVisible && (
        <div className={`bg-white rounded-xl border p-4 mb-4 transition-opacity duration-500 ${
          !rerunning && !rerunError && completedStages.size === 4 ? 'border-emerald-200' :
          rerunError || failedStage ? 'border-red-200' : 'border-amber-200'
        }`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-6">
              {['enrich', 'score', 'brief', 'audit'].map((stage, i, arr) => {
                const isCompleted = completedStages.has(stage);
                const isActive = rerunStage === stage;
                const isFailed = failedStage === stage;
                return (
                  <div key={stage} className="flex items-center gap-2">
                    {i > 0 && (
                      <div className={`w-6 h-0.5 -ml-4 mr-0 ${
                        completedStages.has(arr[i - 1]) ? 'bg-emerald-400' : 'bg-gray-200'
                      }`} />
                    )}
                    <div className="flex items-center gap-1.5">
                      {isFailed ? (
                        <XCircle className="w-4 h-4 text-red-500" />
                      ) : isCompleted ? (
                        <Check className="w-4 h-4 text-emerald-500" />
                      ) : isActive ? (
                        <span className="relative flex h-3 w-3">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500" />
                        </span>
                      ) : (
                        <Circle className="w-3.5 h-3.5 text-gray-300" />
                      )}
                      <span className={`text-xs font-medium capitalize ${
                        isFailed ? 'text-red-600' :
                        isCompleted ? 'text-emerald-600' :
                        isActive ? 'text-amber-700' : 'text-gray-400'
                      }`}>
                        {stage}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            {lead?.campaign_id && (
              <Link
                to={`/campaigns/${lead.campaign_id}`}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-brand-600 transition-colors"
              >
                View activity logs <ArrowRight className="w-3 h-3" />
              </Link>
            )}
          </div>
          <p className={`text-xs ${rerunError || failedStage ? 'text-red-600' : rerunning ? 'text-gray-500' : 'text-emerald-600'}`}>
            {rerunError || rerunStatus || 'Starting rerun...'}
          </p>
        </div>
      )}

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
              <span className={`flex items-center gap-1 ${lead.hq_location ? '' : 'text-gray-300'}`}><MapPin className="w-4 h-4" />{lead.hq_location || 'Unknown'}</span>
              <span className={`flex items-center gap-1 ${lead.employee_count ? '' : 'text-gray-300'}`}>
                <Users className="w-4 h-4" />
                {lead.employee_count ? `~${lead.employee_count.toLocaleString()} employees` : 'Unknown'}
                {(() => {
                  const notes: string = lead.candidate_data_parsed?.notes || '';
                  const srcMatch = notes.match(/Employee count(?: updated from| \()(\w+)/);
                  const divergeMatch = notes.match(/(\d+)x divergence/);
                  return (
                    <>
                      {srcMatch && <span className="text-gray-400 text-xs">({srcMatch[1]})</span>}
                      {divergeMatch && parseInt(divergeMatch[1]) >= 5 && (
                        <span title={`Sources diverged ${divergeMatch[1]}x — cross-validated`}>
                          <AlertTriangle className="w-3 h-3 text-amber-500" />
                        </span>
                      )}
                    </>
                  );
                })()}
              </span>
              <span className={`flex items-center gap-1 ${lead.founded_year ? '' : 'text-gray-300'}`}><Calendar className="w-4 h-4" />{lead.founded_year ? `Founded ${lead.founded_year}` : 'Unknown'}</span>
              <span className={`flex items-center gap-1 ${lead.funding_stage ? '' : 'text-gray-300'}`}><Building2 className="w-4 h-4" />{lead.funding_stage ? `${lead.funding_stage}${lead.total_funding ? ` (${lead.total_funding})` : ''}` : 'N/A'}</span>
              {lead.updated_at && <span className="flex items-center gap-1"><RefreshCw className="w-4 h-4" />Updated {formatDateTimeFull(lead.updated_at)}</span>}
              <a href={`https://${(lead.website || lead.domain || '').replace(/^https?:\/\//, '')}`} target="_blank" rel="noopener" className="flex items-center gap-1 text-brand-600 hover:underline"><Globe className="w-4 h-4" />{(lead.website || lead.domain || '').replace(/^https?:\/\//, '')}</a>
              {lead.linkedin_company_url ? <a href={lead.linkedin_company_url} target="_blank" rel="noopener" className="flex items-center gap-1 text-blue-600 hover:underline"><Linkedin className="w-4 h-4" />LinkedIn</a> : <span className="flex items-center gap-1 text-gray-300"><Linkedin className="w-4 h-4" />LinkedIn</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Cross-Campaign Badge */}
      {(lead as any).cross_campaign?.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 mb-4 flex items-start gap-3">
          <Layers className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-800">Also in {(lead as any).cross_campaign.length} other campaign{(lead as any).cross_campaign.length !== 1 ? 's' : ''}</p>
            <div className="flex flex-wrap gap-2 mt-1.5">
              {(lead as any).cross_campaign.map((cc: any) => (
                <Link
                  key={cc.lead_id}
                  to={`/leads/${cc.lead_id}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-white border border-amber-200 text-amber-700 hover:bg-amber-100 transition-colors"
                >
                  {cc.campaign_name}
                  <span className="text-amber-500">&middot;</span>
                  <span>{cc.fit_score}/100</span>
                  {cc.feedback && <span className="text-amber-500">&middot;</span>}
                  {cc.feedback && <span className="capitalize">{cc.feedback.replace(/_/g, ' ')}</span>}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

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
                    <span>{renderWithCitations(trigger)}</span>
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
                    <p className="text-sm font-medium text-gray-900">{renderWithCitations(p.claim || (typeof p === 'string' ? p : ''))}</p>
                    {p.why_it_matters && <p className="text-sm text-gray-600 mt-0.5">{renderWithCitations(p.why_it_matters)}</p>}
                    {p.evidence_strength && (
                      <span className={`inline-block mt-1 px-1.5 py-0.5 text-[10px] font-medium rounded ${p.evidence_strength === 'confirmed' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                        {p.evidence_strength}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Target Personas — grouped by category */}
          {lead.personas?.length > 0 && (() => {
            const ROLE_ORDER = ['technical_champion', 'hands_on_keyboard', 'economic_buyer', 'executive_sponsor'] as const;
            const ROLE_LABELS: Record<string, string> = {
              technical_champion: 'Technical Champion',
              hands_on_keyboard: 'Hands-on Keyboard',
              economic_buyer: 'Economic Buyer',
              executive_sponsor: 'Executive Sponsor',
              champion: 'Technical Champion',
            };
            const ROLE_COLORS: Record<string, string> = {
              technical_champion: 'border-l-rose-400',
              hands_on_keyboard: 'border-l-blue-400',
              economic_buyer: 'border-l-amber-400',
              executive_sponsor: 'border-l-gray-400',
              champion: 'border-l-rose-400',
            };
            // Deduplicate personas by (name + title + role_type)
            const deduped = lead.personas.filter((p: any, i: number, arr: any[]) =>
              arr.findIndex((q: any) => q.name === p.name && q.title === p.title && q.role_type === p.role_type) === i
            );
            // Group by role_type
            const grouped = ROLE_ORDER.map(role => ({
              role,
              label: ROLE_LABELS[role],
              personas: deduped.filter((p: any) => p.role_type === role || (role === 'technical_champion' && p.role_type === 'champion')),
            })).filter(g => g.personas.length > 0);

            return (
              <Section title="Target Personas" icon={<Users className="w-4 h-4" />}>
                <div className="space-y-4">
                  {grouped.map(group => (
                    <div key={group.role}>
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">{group.label}</p>
                      <div className="space-y-2">
                        {group.personas.map((p: any, i: number) => {
                          const globalIdx = deduped.indexOf(p);
                          return (
                            <div key={p.id} className={`border border-gray-200 rounded-lg border-l-4 ${ROLE_COLORS[p.role_type] || 'border-l-gray-300'}`}>
                              <button
                                onClick={() => setExpandedPersona(expandedPersona === globalIdx ? -1 : globalIdx)}
                                className="w-full flex items-center justify-between p-4 text-left"
                              >
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 text-sm font-bold">
                                    {(p.name || '?')[0]}
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <p className="font-medium text-gray-900">{p.name || 'Unknown'}</p>
                                      {p.confidence && (
                                        <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                                          p.confidence === 'high' ? 'bg-green-50 text-green-700 border border-green-200' :
                                          p.confidence === 'medium' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                                          'bg-gray-50 text-gray-500 border border-gray-200'
                                        }`}>
                                          {p.confidence}
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-xs text-gray-500">{p.title}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {p.linkedin_url && (
                                    <a href={p.linkedin_url} target="_blank" rel="noopener" onClick={e => e.stopPropagation()} className="text-blue-600 hover:text-blue-800">
                                      <Linkedin className="w-4 h-4" />
                                    </a>
                                  )}
                                  {expandedPersona === globalIdx ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                                </div>
                              </button>
                              {expandedPersona === globalIdx && (
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
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            );
          })()}

          {/* Competitive Displacement */}
          {competitive && (
            <Section title="Competitive Displacement" icon={<Shield className="w-4 h-4" />}>
              {competitive.displacement_narrative && (
                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-xs font-medium text-blue-700 uppercase mb-1">Displacement Story</p>
                  <p className="text-sm text-gray-800 leading-relaxed">{renderWithCitations(competitive.displacement_narrative)}</p>
                </div>
              )}
              {competitive.likely_current?.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-medium text-gray-500 uppercase mb-1">Likely Current Solution</p>
                  <div className="flex flex-wrap gap-1.5">
                    {competitive.likely_current.map((c: any, i: number) => {
                      const isStructured = typeof c === 'object' && c.product;
                      const label = isStructured ? c.product : c;
                      const conf = isStructured ? c.confidence : null;
                      return (
                        <span key={i} className="relative group inline-flex items-center gap-1 px-2 py-1 bg-red-50 text-red-700 rounded text-xs">
                          {renderWithCitations(label)}
                          {conf && (
                            <span className={`px-1 py-0.5 text-[10px] font-medium rounded border ${
                              conf === 'high' || conf === 'confirmed' ? 'bg-green-50 text-green-700 border-green-200' :
                              conf === 'medium' || conf === 'inferred' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                              'bg-gray-50 text-gray-500 border-gray-200'
                            }`}>{conf === 'confirmed' ? 'high' : conf === 'inferred' ? 'medium' : conf}</span>
                          )}
                          {isStructured && c.evidence && (
                            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 whitespace-nowrap max-w-xs">
                              <span className="block">{c.evidence}</span>
                              {c.source && <span className="block text-gray-400 mt-0.5">Source: {c.source}</span>}
                            </span>
                          )}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
              {competitive.evidence_sources?.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-medium text-gray-500 uppercase mb-1">Evidence</p>
                  <div className="space-y-1">
                    {competitive.evidence_sources.map((e: any, i: number) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <span className={`px-1 py-0.5 rounded text-[10px] font-medium shrink-0 mt-0.5 ${
                          e.confidence === 'high' || e.confidence === 'confirmed' ? 'bg-green-50 text-green-700' :
                          e.confidence === 'medium' || e.confidence === 'inferred' ? 'bg-amber-50 text-amber-700' :
                          'bg-gray-50 text-gray-500'
                        }`}>{e.confidence === 'confirmed' ? 'high' : e.confidence === 'inferred' ? 'medium' : e.confidence || 'medium'}</span>
                        <span className="text-gray-700">{e.signal}</span>
                        {e.url && <a href={e.url} target="_blank" rel="noopener" className="text-blue-600 hover:underline shrink-0">source</a>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {competitive.twingate_wedge?.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-medium text-gray-500 uppercase mb-1">Competitive Advantage</p>
                  <div className="flex flex-wrap gap-1.5">
                    {competitive.twingate_wedge.map((w: string, i: number) => (
                      <span key={i} className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded text-xs">{renderWithCitations(w)}</span>
                    ))}
                  </div>
                </div>
              )}
              {competitive.proof_points_to_use?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase mb-1">Proof Points</p>
                  <ul className="space-y-1">
                    {competitive.proof_points_to_use.map((pp: string, i: number) => (
                      <li key={i} className="text-xs text-gray-700 flex items-start gap-2">
                        <Check className="w-3 h-3 mt-0.5 text-emerald-500 flex-shrink-0" />{pp}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>
          )}

          {/* Sources */}
          {sources.length > 0 && (
            <Section title={`Sources (${sources.length})`} icon={<ExternalLink className="w-4 h-4" />}>
              <div className="flex items-center gap-3 mb-2 text-[10px] text-gray-400">
                <span className="font-medium text-gray-500">Confidence:</span>
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500" title="Directly observed from primary source" />High</span>
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" title="Strong inference from multiple signals" />Medium</span>
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-gray-400" title="Single weak signal or industry pattern" />Low</span>
              </div>
              <div className="space-y-1">
                {sources.map((s: any, i: number) => {
                  const citId = s.id ?? i + 1;
                  return (
                    <a key={i} id={`source-${citId}`} href={s.url} target="_blank" rel="noopener" className="flex items-center gap-2 text-sm text-blue-600 hover:underline scroll-mt-24">
                      <span className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 rounded shrink-0">{citId}</span>
                      <span className="truncate">{s.label || s.url}</span>
                      <span className="text-xs text-gray-400">({s.type})</span>
                      {s.confidence && (
                        <span className={`px-1 py-0.5 text-[10px] font-medium rounded shrink-0 ${
                          s.confidence === 'high' || s.confidence === 'confirmed' ? 'bg-green-50 text-green-700 border border-green-200' :
                          s.confidence === 'medium' || s.confidence === 'inferred' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                          'bg-gray-50 text-gray-500 border border-gray-200'
                        }`}>
                          {s.confidence === 'confirmed' ? 'high' : s.confidence === 'inferred' ? 'medium' : s.confidence}
                        </span>
                      )}
                    </a>
                  );
                })}
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
          <FeedbackPanel
            leadId={lead.id}
            companyName={lead.company_name}
            feedbackList={feedbackList}
            onFeedbackSubmitted={refreshLead}
          />

          {/* Tech Stack */}
          {techStack && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="font-medium text-gray-900 mb-3 flex items-center gap-2"><Server className="w-4 h-4" /> Tech Stack Intel</h3>
              <div className="space-y-3 text-sm">
                {(() => {
                  // Build unified category map: prefer new `categories` field, fall back to legacy fields
                  const cats: Record<string, any[]> = {};
                  if (techStack.categories && Object.keys(techStack.categories).length > 0) {
                    for (const [k, items] of Object.entries(techStack.categories)) {
                      if (Array.isArray(items) && items.length > 0) cats[k] = items;
                    }
                  } else {
                    if (techStack.vpn_product) cats['vpn'] = [techStack.vpn_product];
                    if (techStack.pam_product) cats['pam'] = [techStack.pam_product];
                    if (techStack.cloud_infra?.length > 0) cats['cloud'] = techStack.cloud_infra;
                    if (techStack.dev_tools?.length > 0) cats['devops'] = techStack.dev_tools;
                  }
                  const LABELS: Record<string, string> = {
                    vpn: 'VPN', pam: 'PAM', mdm: 'MDM', edr: 'EDR', idp: 'IdP',
                    cloud: 'Cloud', siem: 'SIEM', devops: 'DevOps',
                  };
                  return Object.entries(cats).map(([catId, items]) => (
                    <div key={catId}>
                      <p className="text-xs text-gray-500 uppercase">{LABELS[catId] || catId}</p>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {items.map((item: any, i: number) => <TechTag key={i} item={item} />)}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          )}

          {/* Score Breakdown */}
          {scoreBreakdown && (() => {
            const CATEGORY_META: Record<string, { label: string; max: number }> = {
              segment_scale_fit: { label: 'Segment & Scale Fit', max: 20 },
              why_now_triggers: { label: 'Why Now Triggers', max: 15 },
              remote_access_pain: { label: 'Remote Access Pain', max: 20 },
              displacement_wedge: { label: 'Displacement Wedge', max: 20 },
              vertical_playbook: { label: 'Vertical / Playbook', max: 15 },
              buyer_access_readiness: { label: 'Buyer Access & Readiness', max: 10 },
            };
            const categories = Object.entries(CATEGORY_META).map(([key, meta]) => {
              const cat = (scoreBreakdown as any)[key];
              return {
                key,
                label: meta.label,
                points: cat?.points || 0,
                max: meta.max,
                evidence: (cat?.evidence || []) as string[],
              };
            });
            const total = scoreBreakdown.total || lead.fit_score || 0;

            return (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium text-gray-900 flex items-center gap-2">
                    <Signal className="w-4 h-4" /> Score Breakdown
                  </h3>
                  <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${
                    total >= 75 ? 'bg-emerald-100 text-emerald-700' :
                    total >= 60 ? 'bg-amber-100 text-amber-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    {total}/100
                  </span>
                </div>
                <div className="space-y-1">
                  {categories.map((cat) => {
                    const pct = cat.max > 0 ? cat.points / cat.max : 0;
                    const barColor = pct >= 0.7 ? 'bg-emerald-500' : pct >= 0.4 ? 'bg-amber-500' : 'bg-red-400';
                    const hasEvidence = cat.evidence.length > 0;
                    const isExpanded = expandedSignalCat === cat.key;
                    return (
                      <div key={cat.key}>
                        <button
                          onClick={() => hasEvidence && setExpandedSignalCat(isExpanded ? null : cat.key)}
                          className={`w-full flex items-center gap-2 py-1.5 rounded -mx-1 px-1 ${hasEvidence ? 'hover:bg-gray-50 cursor-pointer' : 'cursor-default'}`}
                        >
                          <span className="w-28 text-xs font-medium text-gray-700 text-left truncate shrink-0">{cat.label}</span>
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${Math.round(pct * 100)}%` }} />
                          </div>
                          <span className="w-10 text-right text-[11px] text-gray-400 shrink-0">{cat.points}/{cat.max}</span>
                          {hasEvidence ? (
                            <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
                          ) : (
                            <span className="w-3 h-3 shrink-0" />
                          )}
                        </button>
                        {isExpanded && (
                          <ul className="ml-4 mt-0.5 mb-1 space-y-0.5">
                            {cat.evidence.map((ev, j) => (
                              <li key={j} className="text-[11px] text-gray-500 flex items-start gap-1.5">
                                <span className="w-1 h-1 rounded-full bg-gray-300 mt-1.5 shrink-0" />
                                <span>{renderWithCitations(ev)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
                {(scoreBreakdown.penalties || []).length > 0 && (
                  <div className="border-t mt-2 pt-2 space-y-1">
                    {(scoreBreakdown.penalties || []).map((p: any, i: number) => (
                      <div key={i} className="text-xs text-red-600">Penalty: {p.points} &mdash; {p.reason}</div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Audit Quality */}
          {lead.audit_score != null && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium text-gray-900 flex items-center gap-2">
                  <ClipboardCheck className="w-4 h-4" />
                  Audit Quality
                  {lead.ai_audit && <Sparkles className="w-3.5 h-3.5 text-violet-500" />}
                </h3>
                <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${
                  lead.audit_score >= 70 ? 'bg-green-100 text-green-700' :
                  lead.audit_score >= 50 ? 'bg-amber-100 text-amber-700' :
                  'bg-red-100 text-red-700'
                }`}>
                  {lead.audit_score}/100
                </span>
              </div>

              {/* AI Audit Summary */}
              {lead.ai_audit && (
                <div className="mb-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      lead.ai_audit.verdict === 'pass' ? 'bg-green-100 text-green-700' :
                      lead.ai_audit.verdict === 'needs_work' ? 'bg-amber-100 text-amber-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {lead.ai_audit.verdict === 'pass' ? 'Pass' : lead.ai_audit.verdict === 'needs_work' ? 'Needs Work' : 'Fail'}
                    </span>
                    <span className="text-xs text-gray-500">AI Score: {lead.ai_audit.overall_score}/100</span>
                  </div>
                  {lead.ai_audit.summary && (
                    <p className="text-xs text-gray-600 italic">{lead.ai_audit.summary}</p>
                  )}

                  {/* Dimension Scores */}
                  {lead.ai_audit.dimensions && Object.keys(lead.ai_audit.dimensions).length > 0 && (
                    <div className="space-y-1.5 mt-2">
                      {Object.entries(lead.ai_audit.dimensions).map(([dim, data]: [string, any]) => (
                        <div key={dim} className="group">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-gray-500 w-24 truncate capitalize">{dim.replace(/_/g, ' ')}</span>
                            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  data.score >= 8 ? 'bg-green-500' : data.score >= 5 ? 'bg-amber-500' : 'bg-red-500'
                                }`}
                                style={{ width: `${data.score * 10}%` }}
                              />
                            </div>
                            <span className="text-[11px] font-medium text-gray-600 w-6 text-right">{data.score}</span>
                          </div>
                          {data.feedback && (
                            <p className="text-[10px] text-gray-400 ml-[6.5rem] hidden group-hover:block">{data.feedback}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Strengths */}
                  {lead.ai_audit.strengths && lead.ai_audit.strengths.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {lead.ai_audit.strengths.map((s: string, i: number) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 bg-green-50 text-green-700 rounded">
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Issues */}
              {lead.audit_issues_parsed && lead.audit_issues_parsed.length > 0 && (
                <div className="space-y-1.5 mt-3">
                  {lead.audit_issues_parsed
                    .sort((a: any, b: any) => {
                      const order: Record<string, number> = { error: 0, warning: 1, info: 2 };
                      return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
                    })
                    .map((issue: any, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className={`px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${
                        issue.severity === 'error' ? 'bg-red-100 text-red-700' :
                        issue.severity === 'warning' ? 'bg-amber-100 text-amber-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {issue.check === 'ai_review' ? 'AI' : issue.severity}
                      </span>
                      <span className="text-gray-600">{issue.message}</span>
                    </div>
                  ))}
                </div>
              )}
              {lead.audit_issues_parsed && lead.audit_issues_parsed.length === 0 && (
                <p className="text-xs text-green-600">No issues found — all checks passed.</p>
              )}
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

function TechTag({ item }: { item: string | { product: string; confidence: string; evidence: string; source: string } }) {
  if (typeof item === 'string') {
    return <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-700">{item}</span>;
  }
  const confStyle = item.confidence === 'high'
    ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
    : item.confidence === 'medium'
    ? 'text-amber-600 bg-amber-50 border-amber-200'
    : 'text-gray-500 bg-gray-50 border-gray-200';
  const confLabel = item.confidence === 'high' ? 'H' : item.confidence === 'medium' ? 'M' : 'L';
  const sourceUrl = item.source?.startsWith('http') ? item.source : null;
  const badge = (
    <span className={`inline-flex items-center justify-center w-4 h-4 text-[9px] font-bold rounded border ${confStyle} align-super ml-0.5`}>
      {confLabel}
    </span>
  );
  return (
    <span className="relative group inline-flex items-center">
      <span className="px-2 py-0.5 rounded-l text-xs bg-gray-100 text-gray-700">{item.product}</span>
      {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noopener" className="cursor-pointer">{badge}</a> : badge}
      {(item.evidence || item.source) && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 whitespace-nowrap max-w-xs">
          {item.evidence && <span className="block">{item.evidence}</span>}
          {item.source && <span className="block text-gray-400 mt-0.5">Source: {item.source}</span>}
        </span>
      )}
    </span>
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
