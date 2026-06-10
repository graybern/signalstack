import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthContext } from '../App';
import { permissions } from '../utils/permissions';
import { useEventStream } from '../hooks/useEventStream';
import { formatDate, formatDateTimeFull } from '../utils/dates';
import { ScoreBadge, ScoreLabel, ConfidenceBadge, SegmentBadge, ScoreRing, GradeBadge, GradeTooltip, DimensionRail, SourceDot, ThreeBucketStrip, ActionCard, WatchBadge, buildBuckets } from '../components/ScoreBadge';
import { renderInlineMarkdown } from '../utils/inlineMarkdown';
import {
  ArrowLeft, ExternalLink, Building2, Users, MapPin, Globe, Calendar,
  Briefcase, Linkedin, MessageSquare, Shield, Server, ChevronDown, ChevronUp,
  Signal, Trash2, AlertTriangle, Brain, FileText, Download, Layers,
  ClipboardCheck, RefreshCw, Sparkles, Check, Circle, XCircle, ArrowRight, SlidersHorizontal,
  Target, Clock, Mail, BarChart3, Search, Radio, Crosshair, Pencil,
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
  const [expandedSource, setExpandedSource] = useState<string | null>(null);
  const [showRerunMenu, setShowRerunMenu] = useState(false);
  const [rerunCampaign, setRerunCampaign] = useState<{ leadId: string; campaignName: string; campaignId: string } | null>(null);
  const [rerunMode, setRerunMode] = useState<'full' | 'brief'>('full');
  const [editingLinkedin, setEditingLinkedin] = useState(false);
  const [linkedinInput, setLinkedinInput] = useState('');
  const [linkedinSaving, setLinkedinSaving] = useState(false);
  const [linkedinError, setLinkedinError] = useState<string | null>(null);
  const briefMenuRef = useRef<HTMLDivElement>(null);
  const rerunMenuRef = useRef<HTMLDivElement>(null);

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
      if (rerunMenuRef.current && !rerunMenuRef.current.contains(e.target as Node)) {
        setShowRerunMenu(false);
      }
    }
    if (showBriefMenu || showRerunMenu) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showBriefMenu, showRerunMenu]);

  const fetchLead = useCallback(() => api(`/leads/${id}`).then((data: any) => {
    setLead(data);
    return data;
  }), [id]);
  useEffect(() => {
    fetchLead().then((data: any) => {
      if (data?.active_run) {
        const run = data.active_run;
        if (run.status === 'running' || run.status === 'pending') {
          setRerunning(true);
          setRerunVisible(true);
          setRerunRunId(run.id);
          const steps: string[] = run.steps_run ? JSON.parse(run.steps_run) : ['enrich', 'score', 'brief', 'audit'];
          const currentPhase = run.progress?.phase || run.progress?.current_step;
          // Map pipeline_stage to the rerun step names
          const STAGE_TO_STEP: Record<string, string[]> = {
            enriched: ['enrich'], scored: ['enrich', 'score'],
            briefed: ['enrich', 'score', 'brief'], audited: ['enrich', 'score', 'brief', 'audit'],
          };
          const leadStage = data.pipeline_stage;
          const doneFromLead = new Set<string>((STAGE_TO_STEP[leadStage] || []).filter((s: string) => steps.includes(s)));
          // If the run reports a current phase, mark everything before it as done
          if (currentPhase && steps.includes(currentPhase)) {
            const idx = steps.indexOf(currentPhase);
            for (let i = 0; i < idx; i++) doneFromLead.add(steps[i]);
            setRerunStage(currentPhase);
          }
          setCompletedStages(doneFromLead);
        } else if (run.status === 'completed' && run.completed_at) {
          const completedMs = new Date(run.completed_at).getTime();
          if (Date.now() - completedMs < 60_000) {
            setRerunVisible(true);
            setCompletedStages(new Set(['enrich', 'score', 'brief', 'audit']));
            setTimeout(() => setRerunVisible(false), 5000);
          }
        }
      }
    }).finally(() => setLoading(false));
  }, [id]);

  // SSE subscription for stage rerun progress — also enabled when banner is visible (hydrated from active_run)
  const { subscribe } = useEventStream({ types: ['lead.brief_rerun', 'lead.stage_rerun'], enabled: rerunning || rerunVisible });
  useEffect(() => {
    if (!rerunning && !rerunVisible) return;
    const unsubs: (() => void)[] = [];
    const crossIds = new Set([id, ...(lead?.cross_campaign?.map((cc: any) => cc.lead_id) || [])]);
    const handleStageEvent = (event: any) => {
      if (!crossIds.has(event.data?.lead_id)) return;
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
      if (!crossIds.has(event.data?.lead_id)) return;
      const { status, message } = event.data;
      setRerunStatus(message || status);
      if (status === 'completed') {
        fetchLead().finally(() => {
          setRerunning(false);
          setCompletedStages(prev => {
            const all = new Set(prev);
            ['enrich', 'score', 'brief', 'audit'].forEach(s => all.add(s));
            return all;
          });
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
  }, [rerunning, rerunVisible, id, subscribe, fetchLead, rerunRunId, lead]);

  const handleRerun = async (targetLeadId?: string, mode?: 'full' | 'brief') => {
    const lid = targetLeadId || id;
    const isBriefOnly = (mode || rerunMode) === 'brief';
    setRerunning(true);
    setRerunVisible(true);
    setRerunStatus('Starting rerun...');
    setRerunError(null);
    setRerunStage(null);
    setCompletedStages(new Set());
    setFailedStage(null);
    setRerunRunId(null);
    setShowRerunMenu(false);
    try {
      await api(`/leads/${lid}/rerun-brief`, {
        method: 'POST',
        ...(isBriefOnly ? { body: JSON.stringify({ force_brief: true }) } : {}),
      });
    } catch (err: any) {
      console.error('Rerun failed:', err);
      setRerunning(false);
      setRerunError(err?.message || 'Failed to start rerun');
    }
  };

  const handleForceBrief = async () => {
    setRerunning(true);
    setRerunVisible(true);
    setRerunStatus('Generating brief...');
    setRerunError(null);
    setRerunStage(null);
    setCompletedStages(new Set());
    setFailedStage(null);
    setRerunRunId(null);
    try {
      await api(`/leads/${id}/rerun-brief`, { method: 'POST', body: JSON.stringify({ force_brief: true }) });
    } catch (err: any) {
      console.error('Force brief failed:', err);
      setRerunning(false);
      setRerunError(err?.message || 'Failed to generate brief');
    }
  };

  const handleLinkedinSave = async () => {
    if (!linkedinInput.trim()) return;
    const slug = linkedinInput.match(/linkedin\.com\/company\/([a-zA-Z0-9_-]+)/);
    if (!slug) { setLinkedinError('Paste a valid LinkedIn company URL'); return; }
    setLinkedinSaving(true);
    setLinkedinError(null);
    try {
      await api(`/leads/${id}/linkedin`, { method: 'PATCH', body: JSON.stringify({ linkedin_url: linkedinInput.trim() }) });
      fetchLead();
      setEditingLinkedin(false);
      setLinkedinInput('');
    } catch (err: any) {
      setLinkedinError(err?.message || 'Failed to update LinkedIn URL');
    } finally {
      setLinkedinSaving(false);
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
            <div className="relative" ref={rerunMenuRef}>
              <button
                onClick={() => {
                  if ((lead as any).cross_campaign?.length > 0) {
                    setShowRerunMenu(!showRerunMenu);
                    if (!rerunCampaign) setRerunCampaign({ leadId: id!, campaignName: lead.campaign_name, campaignId: lead.campaign_id });
                  } else {
                    handleRerun();
                  }
                }}
                disabled={rerunning}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-lg disabled:opacity-50 transition-colors ${
                  rerunError ? 'border-red-300 text-red-700 bg-red-50' :
                  rerunning ? 'border-amber-300 text-amber-700 bg-amber-50' :
                  'border-amber-300 text-amber-700 hover:bg-amber-50'
                }`}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${rerunning ? 'animate-spin' : ''}`} />
                {rerunError ? 'Failed' : rerunning ? 'Rerunning...' : 'Rerun'}
                {(lead as any).cross_campaign?.length > 0 && !rerunning && (
                  <ChevronDown className="w-3 h-3" />
                )}
              </button>
              {showRerunMenu && (
                <div className="absolute right-0 top-full mt-1 w-72 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-2">
                  <div className="px-3 pb-2 mb-1 border-b border-gray-100">
                    <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Campaign</p>
                  </div>
                  {/* Current campaign */}
                  <button
                    onClick={() => setRerunCampaign({ leadId: id!, campaignName: lead.campaign_name, campaignId: lead.campaign_id })}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                      rerunCampaign?.campaignId === lead.campaign_id
                        ? 'bg-brand-50 border-l-2 border-brand-400'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <Target className="w-3.5 h-3.5 text-brand-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-gray-900 truncate block">{lead.campaign_name}</span>
                      <span className="text-[10px] text-gray-400">Current · {lead.fit_score}/100</span>
                    </div>
                  </button>
                  {/* Other campaigns */}
                  {(lead as any).cross_campaign?.map((cc: any) => (
                    <button
                      key={cc.lead_id}
                      onClick={() => setRerunCampaign({ leadId: cc.lead_id, campaignName: cc.campaign_name, campaignId: cc.campaign_id })}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                        rerunCampaign?.campaignId === cc.campaign_id
                          ? 'bg-brand-50 border-l-2 border-brand-400'
                          : 'hover:bg-gray-50'
                      }`}
                    >
                      <Layers className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-gray-700 truncate block">{cc.campaign_name}</span>
                        <span className="text-[10px] text-gray-400">{cc.fit_score}/100{cc.feedback ? ` · ${cc.feedback.replace(/_/g, ' ')}` : ''}</span>
                      </div>
                    </button>
                  ))}
                  {/* Mode toggle */}
                  <div className="px-3 pt-2 mt-1 border-t border-gray-100">
                    <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1.5">Mode</p>
                    <div className="flex gap-1.5 mb-2">
                      <button
                        onClick={() => setRerunMode('full')}
                        className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                          rerunMode === 'full' ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'
                        }`}
                      >
                        Full rerun
                        <span className="block text-[9px] opacity-60 mt-0.5">Enrich + Score + Brief</span>
                      </button>
                      <button
                        onClick={() => setRerunMode('brief')}
                        className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                          rerunMode === 'brief' ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'
                        }`}
                      >
                        Brief only
                        <span className="block text-[9px] opacity-60 mt-0.5">Regenerate brief</span>
                      </button>
                    </div>
                    <button
                      onClick={() => handleRerun(rerunCampaign?.leadId, rerunMode)}
                      className="w-full py-1.5 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-amber-950 transition-colors"
                    >
                      Start {rerunMode === 'full' ? 'full rerun' : 'brief generation'}
                    </button>
                  </div>
                </div>
              )}
            </div>
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

      {/* Header — 3-Zone Layout for v2, classic for v1 */}
      <div className="bg-white rounded-xl border border-gray-200 mb-4 overflow-hidden">
        {/* Zone 1 — Identity + Verdict */}
        <div className="p-6">
          <div className="flex items-start gap-4">
            {lead.scoring_version === 2 && lead.dimensions_parsed ? (
              <ScoreRing score={lead.fit_score} size={80} grade={lead.dimensions_parsed.data_confidence} />
            ) : (
              <ScoreBadge score={lead.fit_score} size="lg" />
            )}
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-2xl font-bold">{lead.company_name}</h1>
                <span className="inline-flex items-center gap-1.5">
                  <SegmentBadge segment={lead.segment} />
                  <span className="text-xs text-gray-500">{lead.segment === 'ENT' ? 'Enterprise' : lead.segment === 'MM' ? 'Mid-Market' : 'Small Business'}</span>
                </span>
                {lead.scoring_version === 2 && lead.dimensions_parsed?.data_confidence ? (
                  <span className="inline-flex items-center gap-1">
                    <span className="text-[10px] text-gray-400 uppercase tracking-wide">Data</span>
                    <GradeTooltip grade={lead.dimensions_parsed.data_confidence} />
                  </span>
                ) : (
                  <ConfidenceBadge confidence={lead.confidence || 'medium'} />
                )}
                {lead.feedback?.length > 0 && lead.feedback[0].verdict && (
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                    lead.feedback[0].verdict === 'good_fit' ? 'bg-emerald-50 text-emerald-700' :
                    lead.feedback[0].verdict === 'bad_fit' ? 'bg-red-50 text-red-700' :
                    'bg-amber-50 text-amber-700'
                  }`}>
                    {lead.feedback[0].verdict.replace(/_/g, ' ')}
                  </span>
                )}
                {signalCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                    <Signal className="w-3 h-3" />
                    {signalCount} {signalCount === 1 ? 'signal' : 'signals'}
                  </span>
                )}
              </div>
              {/* Verdict line */}
              {lead.scoring_version === 2 && lead.dimensions_parsed?.verdict ? (
                <p className="text-sm text-gray-600 mb-2">{lead.dimensions_parsed.verdict}</p>
              ) : (
                <div className="flex items-center gap-1 text-sm text-gray-500 mb-2">
                  <ScoreLabel score={lead.fit_score} />
                  <span className="mx-1">&middot;</span>
                  <span>{lead.fit_score}/100</span>
                </div>
              )}
              {/* Metadata strip */}
              <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                {lead.campaign_name && (
                  <Link to={`/campaigns/${lead.campaign_id}`} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-brand-50 text-brand-700 border border-brand-200 hover:bg-brand-100 transition-colors">
                    <Target className="w-3 h-3" />
                    {lead.campaign_name}
                  </Link>
                )}
                <span className={`flex items-center gap-1 ${lead.hq_location ? '' : 'text-gray-300'}`}><MapPin className="w-4 h-4" />{lead.hq_location || '—'}</span>
                <span className={`flex items-center gap-1 ${lead.employee_count ? '' : 'text-gray-300'}`}>
                  <Users className="w-4 h-4" />
                  {lead.employee_count ? `~${lead.employee_count.toLocaleString()} employees` : '—'}
                  {(() => {
                    const src = lead.employee_count_source;
                    const notes: string = lead.candidate_data_parsed?.notes || '';
                    const divergeMatch = notes.match(/(\d+)x divergence/);
                    return (
                      <>
                        {src && <SourceDot status={src === 'enrichment' ? 'confirmed' : 'inferred'} />}
                        {divergeMatch && parseInt(divergeMatch[1]) >= 5 && (
                          <span title={`Sources diverged ${divergeMatch[1]}x — cross-validated`}>
                            <AlertTriangle className="w-3 h-3 text-amber-500" />
                          </span>
                        )}
                      </>
                    );
                  })()}
                </span>
                <span className={`flex items-center gap-1 ${lead.founded_year ? '' : 'text-gray-300'}`}><Calendar className="w-4 h-4" />{lead.founded_year ? `Founded ${lead.founded_year}` : '—'}</span>
                {lead.funding_stage && <span className="flex items-center gap-1"><Building2 className="w-4 h-4" />{lead.funding_stage}{lead.total_funding ? ` (${lead.total_funding})` : ''}</span>}
                {lead.updated_at && <span className="flex items-center gap-1"><RefreshCw className="w-4 h-4" />Updated {formatDateTimeFull(lead.updated_at)}</span>}
                <a href={`https://${(lead.website || lead.domain || '').replace(/^https?:\/\//, '')}`} target="_blank" rel="noopener" className="flex items-center gap-1 text-brand-600 hover:underline"><Globe className="w-4 h-4" />{(lead.website || lead.domain || '').replace(/^https?:\/\//, '')}</a>
                {editingLinkedin ? (
                  <span className="flex items-center gap-1 flex-wrap">
                    <Linkedin className="w-4 h-4 text-blue-600" />
                    <input
                      type="text"
                      value={linkedinInput}
                      onChange={e => { setLinkedinInput(e.target.value); setLinkedinError(null); }}
                      onKeyDown={e => { if (e.key === 'Enter') handleLinkedinSave(); if (e.key === 'Escape') { setEditingLinkedin(false); setLinkedinError(null); } }}
                      placeholder="https://linkedin.com/company/..."
                      className="text-xs border border-blue-300 rounded px-1.5 py-0.5 w-56 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      autoFocus
                      disabled={linkedinSaving}
                    />
                    <button onClick={handleLinkedinSave} disabled={linkedinSaving} className="text-[10px] px-1.5 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                      {linkedinSaving ? '...' : 'Save'}
                    </button>
                    <button onClick={() => { setEditingLinkedin(false); setLinkedinError(null); }} className="text-[10px] text-gray-400 hover:text-gray-600">Cancel</button>
                    {linkedinError && <span className="text-[9px] text-red-500 basis-full ml-5">{linkedinError}</span>}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 group">
                    {lead.enrichment_metadata_parsed?.linkedin_match && (() => {
                      const lm = lead.enrichment_metadata_parsed.linkedin_match;
                      const color = lm.confidence === 'high' ? 'bg-emerald-400' : lm.confidence === 'medium' ? 'bg-amber-400' : 'bg-red-400';
                      const tip = lm.confidence === 'high' ? 'High confidence match'
                        : lm.confidence === 'medium' ? 'Medium confidence — slug partially matches'
                        : 'Low confidence — slug may not match company';
                      return <span className={`w-2 h-2 rounded-full ${color} inline-block`} title={tip} />;
                    })()}
                    {lead.linkedin_company_url ? (
                      <a href={lead.linkedin_company_url} target="_blank" rel="noopener" className="flex items-center gap-1 text-blue-600 hover:underline">
                        <Linkedin className="w-4 h-4" />LinkedIn
                      </a>
                    ) : (
                      <span className="flex items-center gap-1 text-gray-300 text-xs italic border-b border-dashed border-gray-300">
                        <Linkedin className="w-4 h-4" />No LinkedIn
                      </span>
                    )}
                    {lead.enrichment_metadata_parsed?.linkedin_match?.slug_matches_name === false && (
                      <span title={`LinkedIn slug "${lead.enrichment_metadata_parsed.linkedin_match.slug}" may not match "${lead.company_name}"`}>
                        <AlertTriangle className="w-3 h-3 text-amber-500" />
                      </span>
                    )}
                    <button
                      onClick={() => { setLinkedinInput(lead.linkedin_company_url || ''); setEditingLinkedin(true); }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-blue-600"
                      title="Edit LinkedIn URL"
                      disabled={rerunning}
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  </span>
                )}
              </div>
              {(!lead.hq_location || !lead.employee_count || !lead.founded_year) && lead.campaign_id && !rerunning && (
                <button
                  onClick={() => handleRerun()}
                  className="mt-2 flex items-center gap-1 text-[11px] text-gray-400 hover:text-brand-600 transition-colors"
                >
                  <RefreshCw className="w-3 h-3" />
                  Re-enrich missing data
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Zone 2 — Three-Bucket Strip (v2) or Dimension Rail (v1) */}
        {lead.scoring_version === 2 && lead.dimensions_parsed && (
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200/60">
            <ThreeBucketStrip dimensions={lead.dimensions_parsed} />
          </div>
        )}

        {/* Zone 3 — Context Bar */}
        <div className="px-6 py-2 border-t border-gray-100 flex items-center gap-4 text-[11px] text-gray-400">
          {lead.scoring_version === 2 && <span className="font-medium text-gray-500">Deterministic scoring</span>}
          {lead.scoring_model && <span>{lead.scoring_model}</span>}
          {lead.ai_audit && (
            <span className={lead.ai_audit.verdict === 'pass' ? 'text-emerald-500' : lead.ai_audit.verdict === 'fail' ? 'text-red-400' : 'text-amber-400'}>
              Audit: {lead.ai_audit.verdict}
            </span>
          )}
          {lead.enrichment_metadata_parsed && (
            <span>
              Sources: {lead.enrichment_metadata_parsed.sources_responded?.length ?? 0}/{lead.enrichment_metadata_parsed.sources_available?.length ?? 0} checked
            </span>
          )}
          {lead.scored_at && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Scored {formatDate(lead.scored_at)}
            </span>
          )}
          {(lead as any).cross_campaign?.length > 0 && (() => {
            const maxDivergence = Math.max(...(lead as any).cross_campaign.map((cc: any) => Math.abs(cc.fit_score - lead.fit_score)));
            return maxDivergence >= 15 ? (
              <span className="text-amber-500 font-medium">
                <AlertTriangle className="w-3 h-3 inline" /> Score diverges &plusmn;{maxDivergence} across campaigns
              </span>
            ) : null;
          })()}
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
          {/* Brief skipped callout — compact inline bar */}
          {!lead.brief_markdown && lead.fit_score != null && lead.score_breakdown && (
            <div className="bg-gray-50 rounded-lg border border-gray-200 px-4 py-3 flex items-center justify-between gap-4">
              <p className="text-sm text-gray-500">
                <span className="font-medium text-gray-700">No brief generated</span>
                {' — '}
                {lead.brief_threshold ? (
                  <>scored {lead.fit_score}, below {lead.brief_threshold}-pt threshold</>
                ) : lead.brief_candidate_limit ? (
                  <>not in top {lead.brief_candidate_limit} candidates</>
                ) : (
                  <>not selected for brief generation</>
                )}
              </p>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={handleForceBrief}
                  disabled={rerunning}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  <FileText className="w-3 h-3" />
                  Generate anyway
                </button>
                {lead.campaign_id && (
                  <Link
                    to={`/campaigns/${lead.campaign_id}`}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-brand-600 transition-colors"
                  >
                    <SlidersHorizontal className="w-3 h-3" />
                    Threshold
                  </Link>
                )}
              </div>
            </div>
          )}

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
          {lead.scoring_version === 2 && lead.dimensions_parsed && (() => {
            const champion = lead.personas?.find((p: any) => p.role_type === 'technical_champion' || p.role_type === 'champion');
            return (
              <ActionCard
                dimensions={lead.dimensions_parsed}
                leadId={lead.id}
                isWatching={lead.watch_items?.some((w: any) => w.status === 'active')}
                watchWakeDate={lead.watch_items?.find((w: any) => w.status === 'active')?.snooze_until ?? null}
                watchCategory={lead.watch_items?.find((w: any) => w.status === 'active')?.category ?? null}
                watchItemId={lead.watch_items?.find((w: any) => w.status === 'active')?.id ?? null}
                championName={champion?.name}
                championTitle={champion?.title}
                championLinkedIn={champion?.linkedin_url}
                onAction={(action) => {
                  if (action === 'engage' && champion?.linkedin_url) {
                    window.open(champion.linkedin_url, '_blank');
                  } else if (action === 'research') {
                    handleRerun();
                  } else if (action === 'watching') {
                    navigate('/watch-list');
                  }
                }}
                onWatchAdded={refreshLead}
              />
            );
          })()}
          <FeedbackPanel
            leadId={lead.id}
            companyName={lead.company_name}
            feedbackList={feedbackList}
            onFeedbackSubmitted={refreshLead}
          />

          {/* Score Breakdown — v2 Dimensions Panel or v1 Legacy */}
          {lead.scoring_version === 2 && lead.dimensions_parsed ? (() => {
            const dims = lead.dimensions_parsed;
            const factSheet = lead.fact_sheet_parsed;
            const buckets = buildBuckets(dims);

            const DIMENSION_ROWS: Record<string, { key: string; friendly: string; technical: string; icon: typeof Target; getValue: () => string; isGrade?: boolean }[]> = {
              FIT: [
                { key: 'icp_fit', friendly: 'How well do they fit?', technical: 'ICP Fit', icon: Target, getValue: () => `${dims.icp_fit}` },
                { key: 'reachability', friendly: 'Can we reach them?', technical: 'Reachability', icon: Crosshair, getValue: () => `${dims.reachability}` },
              ],
              INTENT: [
                { key: 'timing', friendly: 'Is the timing right?', technical: 'Timing', icon: Clock, getValue: () => `${dims.timing}` },
                { key: 'signal_quality', friendly: 'Are they looking?', technical: 'Signal Quality', icon: Signal, getValue: () => `${dims.signal_quality ?? 0}` },
              ],
              EVIDENCE: [
                { key: 'data_confidence', friendly: 'How sure are we?', technical: 'Data Confidence', icon: BarChart3, getValue: () => `${dims.data_confidence_score ?? 0}`, isGrade: true },
                { key: 'research_completeness', friendly: 'How much do we know?', technical: 'Research', icon: Search, getValue: () => `${dims.research_completeness}%` },
                { key: 'signal_density', friendly: 'How many signals?', technical: 'Signal Density', icon: Radio, getValue: () => `${dims.signal_density?.total_signals ?? 0}` },
              ],
            };

            return (
              <>
                {/* Dimensions Panel — Bucket-Grouped */}
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-medium text-gray-900 flex items-center gap-2">
                      <Signal className="w-4 h-4" /> Scoring Dimensions
                    </h3>
                    <span className={`text-sm font-bold px-2 py-0.5 rounded-full tabular-nums ${
                      lead.fit_score >= 75 ? 'bg-emerald-100 text-emerald-700' :
                      lead.fit_score >= 60 ? 'bg-amber-100 text-amber-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {lead.fit_score}/100
                    </span>
                  </div>

                  {/* Provenance Summary */}
                  {dims.breakdowns && (() => {
                    const allSubs = Object.values(dims.breakdowns).flatMap((bd: any) => bd.sub_scores || []);
                    const totalEv = allSubs.reduce((s: number, sub: any) => s + (sub.evidence?.length || 0), 0);
                    const confirmed = allSubs.reduce((s: number, sub: any) => s + (sub.confidences?.filter((c: string) => c === 'confirmed').length || 0), 0);
                    const inferred = allSubs.reduce((s: number, sub: any) => s + (sub.confidences?.filter((c: string) => c === 'inferred').length || 0), 0);
                    const model = totalEv - confirmed - inferred;
                    const srcCount = lead.enrichment_metadata_parsed?.sources_responded?.length ?? 0;
                    const corrobCount = lead.enrichment_metadata_parsed?.corroboration_count ?? 0;
                    if (totalEv === 0) return null;
                    return (
                      <div className="mb-3 px-2 py-1.5 rounded-md bg-gray-50 border border-gray-100">
                        <div className="flex items-center gap-1.5 text-[10px] text-gray-500 flex-wrap">
                          <span className="tabular-nums font-medium text-gray-600">{totalEv}</span>
                          <span>evidence items</span>
                          {confirmed > 0 && (<>
                            <span className="text-gray-300">·</span>
                            <span className="tabular-nums text-emerald-600 font-medium">{confirmed}</span>
                            <span>confirmed</span>
                          </>)}
                          <span className="text-gray-300">·</span>
                          <span className="tabular-nums">{srcCount}</span>
                          <span>sources</span>
                          {corrobCount > 0 && (<>
                            <span className="text-gray-300">·</span>
                            <span className="tabular-nums text-emerald-600">{corrobCount}</span>
                            <span>corroborated</span>
                          </>)}
                        </div>
                        <div className="flex h-[3px] rounded-full overflow-hidden mt-1">
                          {confirmed > 0 && <div className="bg-emerald-500" style={{ width: `${(confirmed / totalEv) * 100}%` }} />}
                          {inferred > 0 && <div className="bg-amber-400" style={{ width: `${(inferred / totalEv) * 100}%` }} />}
                          {model > 0 && <div className="bg-gray-300" style={{ width: `${(model / totalEv) * 100}%` }} />}
                        </div>
                      </div>
                    );
                  })()}

                  <div className="space-y-3">
                    {buckets.map((bucket) => {
                      const { colorScheme: c } = bucket;
                      const BucketIcon = bucket.icon;
                      const weak = bucket.score < 35;
                      const dimRows = DIMENSION_ROWS[bucket.label] || [];
                      const isEvidence = bucket.label === 'EVIDENCE';
                      const displayScore = isEvidence ? `${Math.round(bucket.score)}%` : String(bucket.score);

                      return (
                        <div key={bucket.label} className={`rounded-lg border-l-[3px] ${c.accentBorder} ${c.bg} border border-r-gray-200/40 border-t-gray-200/40 border-b-gray-200/40 overflow-hidden`}>
                          {/* Bucket Header */}
                          <div className="px-3 pt-2.5 pb-2">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-1.5">
                                <BucketIcon className={`w-3.5 h-3.5 ${c.label}`} />
                                <span className={`text-[10px] font-semibold uppercase tracking-wider ${c.label}`}>{bucket.label}</span>
                                <span className={`text-[9px] ${c.label} opacity-50`}>{bucket.question}</span>
                              </div>
                              <span className={`text-lg font-bold tabular-nums ${weak ? 'text-gray-400' : c.score}`}>{displayScore}</span>
                            </div>
                            <div className={`h-[4px] rounded-full overflow-hidden ${c.barTrack}`}>
                              <div className={`h-full rounded-full transition-all duration-500 ${weak ? 'bg-gray-300' : c.bar}`}
                                style={{ width: `${Math.min(bucket.score, 100)}%` }} />
                            </div>
                          </div>

                          {/* Dimension Rows */}
                          <div className="px-2 pb-2 space-y-px">
                            {dimRows.map((dim) => {
                              const rawValue = dim.key === 'data_confidence' ? (dims.data_confidence_score ?? 0)
                                : dim.key === 'signal_density' ? Math.min((dims.signal_density?.total_signals ?? 0) * 5, 100)
                                : (dims as any)[dim.key] ?? 0;
                              const pct = Math.min(rawValue / 100, 1);
                              const dimWeak = rawValue < 35;
                              const isExpanded = expandedSignalCat === dim.key;
                              const hasDetail = dim.key !== 'signal_density' && dim.key !== 'research_completeness';
                              const DimIcon = dim.icon;

                              return (
                                <div key={dim.key}>
                                  <button
                                    onClick={() => hasDetail && setExpandedSignalCat(isExpanded ? null : dim.key)}
                                    className={`w-full flex items-center gap-2 py-1.5 px-1.5 rounded-md transition-colors ${
                                      hasDetail ? 'hover:bg-white/60 cursor-pointer' : 'cursor-default'
                                    } ${dimWeak ? 'opacity-60' : ''}`}
                                  >
                                    <DimIcon className={`w-3 h-3 ${dimWeak ? 'text-gray-400' : c.subLabel} shrink-0`} />
                                    <div className="flex-1 min-w-0 text-left">
                                      <div className={`text-[11px] font-medium leading-tight ${dimWeak ? 'text-gray-500' : 'text-gray-700'}`}>{dim.friendly}</div>
                                      <div className="text-[9px] text-gray-400 leading-tight">{dim.technical}</div>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      {dim.isGrade && dims.data_confidence && (
                                        <GradeTooltip grade={dims.data_confidence} />
                                      )}
                                      <span className={`text-xs font-semibold tabular-nums ${dimWeak ? 'text-gray-400' : c.score}`}>{dim.getValue()}</span>
                                      {(() => {
                                        const db = dims.breakdowns?.[dim.key];
                                        const dc = (db?.sub_scores || []).flatMap((s: any) => s.confidences || []);
                                        const dt = dc.length;
                                        if (dt === 0) return null;
                                        const dConf = dc.filter((x: string) => x === 'confirmed').length;
                                        const dInf = dc.filter((x: string) => x === 'inferred').length;
                                        const dMod = dt - dConf - dInf;
                                        return (
                                          <div className="flex h-[3px] w-6 rounded-full overflow-hidden" title={`${dConf} confirmed, ${dInf} inferred, ${dMod} model`}>
                                            {dConf > 0 && <div className="bg-emerald-500" style={{ width: `${(dConf / dt) * 100}%` }} />}
                                            {dInf > 0 && <div className="bg-amber-400" style={{ width: `${(dInf / dt) * 100}%` }} />}
                                            {dMod > 0 && <div className="bg-gray-300" style={{ width: `${(dMod / dt) * 100}%` }} />}
                                          </div>
                                        );
                                      })()}
                                      {hasDetail && (
                                        <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                      )}
                                    </div>
                                  </button>

                                  {/* Gauge */}
                                  <div className="px-1.5 pb-1">
                                    <div className={`h-[3px] rounded-full overflow-hidden ${c.barTrack}`}>
                                      <div className={`h-full rounded-full transition-all duration-300 ${dimWeak ? 'bg-gray-300' : c.subBar}`}
                                        style={{ width: `${Math.round(pct * 100)}%` }} />
                                    </div>
                                  </div>

                                  {/* Expandable Evidence — v2 breakdowns or FactSheet fallback */}
                                  {isExpanded && (() => {
                                    const bd = dims.breakdowns?.[dim.key];
                                    if (bd && bd.sub_scores?.length > 0) {
                                      return (
                                        <div className="mx-1.5 mb-2 p-2 rounded-md bg-white/80 border border-gray-100 text-[11px]">
                                          <div className="space-y-1.5">
                                            {bd.sub_scores.map((sub: any, si: number) => {
                                              const subPct = sub.max > 0 ? Math.min(sub.points / sub.max, 1) : 0;
                                              return (
                                                <div key={si}>
                                                  <div className="flex items-center justify-between">
                                                    <span className="text-gray-700 font-medium">{sub.label}</span>
                                                    <span className={`tabular-nums font-semibold ${sub.points > 0 ? 'text-gray-700' : 'text-gray-400'}`}>{sub.points}/{sub.max}</span>
                                                  </div>
                                                  <div className="h-[3px] rounded-full bg-gray-100 mt-0.5 mb-0.5">
                                                    <div className={`h-full rounded-full transition-all ${sub.points > 0 ? c.subBar : 'bg-gray-200'}`}
                                                      style={{ width: `${Math.round(subPct * 100)}%` }} />
                                                  </div>
                                                  {sub.evidence?.length > 0 && (
                                                    <div className="text-[10px] text-gray-500 leading-snug">
                                                      {sub.evidence.map((ev: string, ei: number) => {
                                                        const url = sub.urls?.[ei];
                                                        const conf = sub.confidences?.[ei] as string | undefined;
                                                        const dotColor = conf === 'confirmed' ? 'bg-emerald-500'
                                                          : conf === 'model_knowledge' ? 'bg-gray-300'
                                                          : conf ? 'bg-amber-400' : '';
                                                        const textClass = conf === 'model_knowledge' ? 'text-gray-400 italic'
                                                          : conf === 'confirmed' ? 'font-medium' : '';
                                                        return (
                                                          <span key={ei} className="inline-flex items-start gap-1">
                                                            {ei > 0 && <span className="text-gray-300 mx-0.5">·</span>}
                                                            {dotColor && <span className={`w-1.5 h-1.5 rounded-full ${dotColor} mt-[5px] shrink-0`} />}
                                                            <span className={textClass}>
                                                              {url ? (
                                                                <a href={url} target="_blank" rel="noopener noreferrer"
                                                                  className="text-blue-600 hover:underline inline-flex items-center gap-0.5">
                                                                  {ev}<ExternalLink className="w-2.5 h-2.5 inline opacity-50" />
                                                                </a>
                                                              ) : ev}
                                                            </span>
                                                          </span>
                                                        );
                                                      })}
                                                    </div>
                                                  )}
                                                </div>
                                              );
                                            })}
                                          </div>
                                          {bd.penalties?.length > 0 && (
                                            <div className="border-t border-gray-100 mt-2 pt-1.5 space-y-0.5">
                                              {bd.penalties.map((p: any, pi: number) => (
                                                <div key={pi} className="text-[10px] text-red-600 flex items-center gap-1">
                                                  <span className="font-semibold tabular-nums">{p.points}</span>
                                                  <span>{p.reason}</span>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    }
                                    if (!factSheet) return null;
                                    if (dim.key === 'icp_fit') return (
                                      <div className="mx-1.5 mb-2 p-2 rounded-md bg-white/80 border border-gray-100 space-y-0.5 text-[11px] text-gray-500">
                                        <div>Industry: <span className="text-gray-700">{factSheet.industry || 'Unknown'}{factSheet.sub_industry ? ` / ${factSheet.sub_industry}` : ''}</span></div>
                                        <div>Employees: <span className="text-gray-700">{factSheet.employee_count_range}</span> {factSheet.employee_count_confirmed ? <span className="text-emerald-600 text-[9px]">confirmed</span> : <span className="text-amber-500 text-[9px]">unconfirmed</span>}</div>
                                        <div>Remote workforce: <span className="text-gray-700">{factSheet.remote_workforce_evidence}</span></div>
                                        <div>Vertical: <span className="text-gray-700">{factSheet.vertical_match}</span> {factSheet.vertical_name ? <span className="text-gray-400">— {factSheet.vertical_name}</span> : ''}</div>
                                        {factSheet.vpn_products_detected?.length > 0 && (
                                          <div>VPN: {factSheet.vpn_products_detected.map((v: any, i: number) => (
                                            <span key={i} className="inline-flex items-center gap-0.5 mr-1">
                                              {v.url ? (
                                                <a href={v.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{v.product}</a>
                                              ) : (
                                                <span className="text-gray-700">{v.product}</span>
                                              )}
                                              <span className={`text-[9px] ${v.confidence === 'confirmed' ? 'text-emerald-600' : 'text-amber-500'}`}>({v.confidence})</span>
                                            </span>
                                          ))}</div>
                                        )}
                                      </div>
                                    );
                                    if (dim.key === 'timing') return (
                                      <div className="mx-1.5 mb-2 p-2 rounded-md bg-white/80 border border-gray-100 space-y-0.5 text-[11px] text-gray-500">
                                        {factSheet.active_evaluation_evidence?.length > 0 && (
                                          <div className="text-amber-700 font-medium">Active evaluation: {factSheet.active_evaluation_evidence.map((e: any) => `${e.description} (${e.confidence})`).join('; ')}</div>
                                        )}
                                        {factSheet.funding_events?.length > 0 && (
                                          <div>Funding: {factSheet.funding_events.map((f: any) => `${f.type}${f.amount ? ` ${f.amount}` : ''} (${f.recency})`).join(', ')}</div>
                                        )}
                                        {factSheet.hiring_signals?.length > 0 && (
                                          <div>Hiring: {factSheet.hiring_signals.map((h: any) => `${h.role} (${h.recency})`).join(', ')}</div>
                                        )}
                                      </div>
                                    );
                                    if (dim.key === 'data_confidence') return (
                                      <div className="mx-1.5 mb-2 p-2 rounded-md bg-white/80 border border-gray-100 space-y-0.5 text-[11px] text-gray-500">
                                        <div>Enrichment facts: <span className="text-gray-700 font-medium">{factSheet.facts_from_enrichment ?? 0}</span></div>
                                        <div>Model knowledge: <span className="text-gray-700">{factSheet.facts_from_model_knowledge ?? 0}</span></div>
                                      </div>
                                    );
                                    if (dim.key === 'reachability') return (
                                      <div className="mx-1.5 mb-2 p-2 rounded-md bg-white/80 border border-gray-100 space-y-0.5 text-[11px] text-gray-500">
                                        {factSheet.named_contacts?.length > 0 ? factSheet.named_contacts.map((ct: any, i: number) => (
                                          <div key={i} className="flex items-center gap-1 flex-wrap">
                                            <span className="text-gray-700 font-medium">{ct.name || 'Unnamed'}</span>
                                            <span className="text-gray-400">— {ct.title}</span>
                                            <span className={`text-[9px] px-1 py-px rounded ${
                                              ct.role_fit === 'champion' ? 'bg-sky-50 text-sky-700' :
                                              ct.role_fit === 'economic_buyer' ? 'bg-amber-50 text-amber-700' :
                                              'bg-gray-100 text-gray-500'
                                            }`}>{ct.role_fit}</span>
                                            {ct.has_linkedin && (ct.linkedin_url ? (
                                              <a href={ct.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-600 hover:underline inline-flex items-center gap-0.5">LinkedIn<ExternalLink className="w-2 h-2 opacity-50" /></a>
                                            ) : <span className="text-[9px] text-blue-500">LinkedIn</span>)}
                                          </div>
                                        )) : <div className="text-gray-400 italic">No named contacts found</div>}
                                      </div>
                                    );
                                    if (dim.key === 'signal_quality') return (
                                      <div className="mx-1.5 mb-2 p-2 rounded-md bg-white/80 border border-gray-100 text-[11px] text-gray-500">
                                        <div className="text-gray-400 italic">Signal strength derived from weighted buying signals — see Signal Breakdown below for detail.</div>
                                      </div>
                                    );
                                    return null;
                                  })()}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {scoreBreakdown && (scoreBreakdown.penalties || []).length > 0 && (
                    <div className="border-t mt-2 pt-2 space-y-1">
                      {(scoreBreakdown.penalties || []).map((p: any, i: number) => (
                        <div key={i} className="text-xs text-red-600">Penalty: {p.points} &mdash; {p.reason}</div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Signal Breakdown */}
                {dims.signal_density && dims.signal_density.categories && Object.keys(dims.signal_density.categories).length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <h3 className="font-medium text-gray-900 flex items-center gap-2 mb-3">
                      <Signal className="w-4 h-4" /> Signal Breakdown
                    </h3>
                    <div className="space-y-2">
                      {Object.entries(dims.signal_density.categories as Record<string, any[]>).map(([cat, signals]) => (
                        <div key={cat}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium text-gray-700 capitalize">{cat}</span>
                            <span className="text-[10px] text-gray-400">{signals.length}</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {signals.map((sig: any, i: number) => (
                              <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                                sig.recency === 'recent' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
                                sig.recency === 'aged' ? 'bg-gray-50 text-gray-500 border-gray-200 opacity-60' :
                                'bg-gray-50 text-gray-400 border-gray-200 opacity-50'
                              }`}>
                                {sig.signal || sig.description || cat}
                                {sig.source_type === 'model_knowledge' && <span className="ml-0.5 text-[8px] bg-gray-200 text-gray-500 px-1 rounded">AI</span>}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* FactSheet Viewer */}
                {factSheet && (
                  <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <button
                      onClick={() => setExpandedSignalCat(expandedSignalCat === 'factsheet' ? null : 'factsheet')}
                      className="w-full flex items-center justify-between"
                    >
                      <h3 className="font-medium text-gray-900 flex items-center gap-2">
                        <FileText className="w-4 h-4" /> FactSheet
                      </h3>
                      <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${expandedSignalCat === 'factsheet' ? 'rotate-180' : ''}`} />
                    </button>
                    {expandedSignalCat === 'factsheet' && (
                      <div className="mt-3 space-y-3 text-[11px] text-gray-600">
                        <div>
                          <div className="text-[10px] font-medium text-gray-400 uppercase mb-1">Company Profile</div>
                          <div className="space-y-0.5">
                            <div>Industry: {factSheet.industry || '—'}{factSheet.sub_industry ? ` / ${factSheet.sub_industry}` : ''}</div>
                            <div>Employees: {factSheet.employee_count_range} {factSheet.employee_count_confirmed ? '✓' : '?'}</div>
                            <div>Engineering team: {factSheet.engineering_team_evidence ? 'Yes' : 'No evidence'}</div>
                            <div>Contractors: {factSheet.contractor_usage_evidence ? 'Yes' : 'No evidence'}</div>
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-medium text-gray-400 uppercase mb-1">Remote Access</div>
                          <div className="space-y-0.5">
                            <div>Remote workforce: {factSheet.remote_workforce_evidence}</div>
                            <div>BYOD/BYOC: {factSheet.byod_byoc_evidence ? 'Yes' : 'No evidence'}</div>
                            <div>DevEx initiative: {factSheet.developer_experience_initiative ? 'Yes' : 'No evidence'}</div>
                          </div>
                        </div>
                        {(factSheet.vpn_products_detected?.length > 0 || factSheet.competitor_products_detected?.length > 0) && (
                          <div>
                            <div className="text-[10px] font-medium text-gray-400 uppercase mb-1">Displacement</div>
                            <div className="space-y-0.5">
                              {factSheet.vpn_products_detected?.map((v: any, i: number) => (
                                <div key={i}>VPN: {v.product} <span className={v.confidence === 'confirmed' ? 'text-emerald-600' : 'text-amber-500'}>({v.confidence})</span> — {v.source}</div>
                              ))}
                              {factSheet.competitor_products_detected?.map((c: any, i: number) => (
                                <div key={i}>Competitor: {c.product} <span className={c.confidence === 'confirmed' ? 'text-emerald-600' : 'text-amber-500'}>({c.confidence})</span> — {c.source}</div>
                              ))}
                            </div>
                          </div>
                        )}
                        <div>
                          <div className="text-[10px] font-medium text-gray-400 uppercase mb-1">Source Classification</div>
                          <div className="space-y-0.5">
                            <div>Enrichment facts: {factSheet.facts_from_enrichment ?? 0}</div>
                            <div>Model knowledge facts: {factSheet.facts_from_model_knowledge ?? 0}</div>
                            <div>Overall confidence: {factSheet.fact_confidence ?? 'unknown'}</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            );
          })() : scoreBreakdown && (() => {
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

          {/* Tech Stack */}
          {techStack && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="font-medium text-gray-900 mb-3 flex items-center gap-2"><Server className="w-4 h-4" /> Tech Stack Intel</h3>
              <div className="space-y-3 text-sm">
                {(() => {
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

          {/* Data Sources — Auditability Panel */}
          {lead.enrichment_metadata_parsed && (() => {
            const em = lead.enrichment_metadata_parsed;
            const available = em.sources_available || [];
            const responded = new Set(em.sources_responded || []);
            const failed = new Set(em.sources_failed || []);
            const fieldSources = em.field_sources as Record<string, string[]> | undefined;
            const dimBreakdowns = lead.scoring_version === 2 ? lead.dimensions_parsed?.breakdowns : null;

            const DIM_LABELS: Record<string, string> = { icp_fit: 'ICP Fit', timing: 'Timing', reachability: 'Reachability', data_confidence: 'Data', signal_quality: 'Signal Quality' };
            const getSourceEvidence = (src: string): { dimension: string; evidence: string }[] => {
              if (!dimBreakdowns) return [];
              const results: { dimension: string; evidence: string }[] = [];
              const aliases = [src.toLowerCase().replace(/_/g, ' '), src.replace(/_/g, ''), src.toLowerCase()];
              for (const [dimKey, bd] of Object.entries(dimBreakdowns as Record<string, any>)) {
                for (const sub of (bd.sub_scores || [])) {
                  for (let ei = 0; ei < (sub.evidence?.length || 0); ei++) {
                    const haystack = `${sub.evidence[ei]} ${sub.urls?.[ei] || ''}`.toLowerCase();
                    if (aliases.some((a: string) => haystack.includes(a))) {
                      results.push({ dimension: DIM_LABELS[dimKey] || dimKey, evidence: sub.evidence[ei] });
                    }
                  }
                }
              }
              return results;
            };
            const corroborationCount = em.corroboration_count ?? 0;
            const respondedCount = responded.size;
            const totalCount = available.length;

            const getSourceFields = (src: string): string[] => {
              if (!fieldSources) return [];
              return Object.entries(fieldSources)
                .filter(([, sources]) => sources.includes(src))
                .map(([field]) => field);
            };

            const getFieldSourceCount = (field: string): number => {
              return fieldSources?.[field]?.length ?? 0;
            };

            return (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium text-gray-900 flex items-center gap-2">
                    <Globe className="w-4 h-4" /> Data Sources
                  </h3>
                  <div className="flex items-center gap-2">
                    {corroborationCount > 0 && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[9px] font-semibold border border-emerald-200 tracking-wide">
                        {corroborationCount} corroborated
                      </span>
                    )}
                    <span className="text-[10px] text-gray-400 tabular-nums font-medium">{respondedCount}/{totalCount}</span>
                  </div>
                </div>

                {/* Coverage bar */}
                <div className="mb-3">
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-400 rounded-full transition-all duration-500"
                      style={{ width: `${totalCount > 0 ? Math.round((respondedCount / totalCount) * 100) : 0}%` }} />
                  </div>
                </div>

                {/* Source Grid */}
                <div className="space-y-1">
                  {available.map((src: string) => {
                    const isResponded = responded.has(src);
                    const isFailed = failed.has(src);
                    const isExpandable = isResponded && fieldSources && getSourceFields(src).length > 0;
                    const isExpanded = expandedSource === src;

                    return (
                      <div key={src}>
                        <button
                          onClick={() => isExpandable && setExpandedSource(isExpanded ? null : src)}
                          className={`w-full flex items-center gap-2 py-1 px-1.5 rounded-md transition-colors ${
                            isExpandable ? 'hover:bg-gray-50 cursor-pointer' : 'cursor-default'
                          } ${isExpanded ? 'bg-gray-50' : ''}`}
                        >
                          {isResponded ? (
                            <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          ) : isFailed ? (
                            <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                          ) : (
                            <Circle className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                          )}
                          <span className={`text-[11px] flex-1 text-left capitalize ${
                            isFailed ? 'line-through text-gray-400' :
                            isResponded ? 'text-gray-700 font-medium' :
                            'text-gray-400'
                          }`}>
                            {src.replace(/_/g, ' ')}
                          </span>
                          {isExpandable && (
                            <ChevronDown className={`w-3 h-3 text-gray-300 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          )}
                        </button>
                        {isExpanded && (() => {
                          const fields = getSourceFields(src);
                          return (
                            <div className="ml-6 mr-1 mb-1.5 mt-0.5 p-2 rounded-md bg-gray-50/80 border border-gray-100">
                              <div className="text-[9px] uppercase text-gray-400 font-semibold tracking-wider mb-1">Fields contributed</div>
                              <div className="flex flex-wrap gap-1">
                                {fields.map((field: string) => {
                                  const sourceCount = getFieldSourceCount(field);
                                  return (
                                    <span key={field} className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-600">
                                      {field.replace(/_/g, ' ')}
                                      {sourceCount >= 2 && (
                                        <span className="text-[8px] px-1 py-px rounded-full bg-emerald-100 text-emerald-700 font-bold ml-0.5">{sourceCount}x</span>
                                      )}
                                    </span>
                                  );
                                })}
                              </div>
                              {(() => {
                                const evMatches = getSourceEvidence(src);
                                if (evMatches.length === 0) return null;
                                return (
                                  <div className="mt-1.5">
                                    <div className="text-[9px] uppercase text-gray-400 font-semibold tracking-wider mb-1">Evidence contributed</div>
                                    <div className="space-y-0.5">
                                      {evMatches.map((m: any, mi: number) => (
                                        <div key={mi} className="text-[10px] text-gray-500 flex items-start gap-1">
                                          <span className="text-gray-400 shrink-0">{m.dimension}:</span>
                                          <span className="text-gray-600">{m.evidence}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
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
