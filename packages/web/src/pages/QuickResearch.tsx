import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api, downloadFile } from '../api/client';
import { formatDateTime, timeAgo } from '../utils/dates';
import { useEventStream, SSEEvent } from '../hooks/useEventStream';
import { ScoreBadge } from '../components/ScoreBadge';
import { ActivityPanel } from '../components/ActivityPanel';
import { useAuthContext } from '../App';
import { permissions } from '../utils/permissions';
import {
  Search, Loader2, CheckCircle, XCircle, ExternalLink,
  Globe, Target, ArrowRight, RefreshCw, Clock, Eye,
  ChevronUp, ChevronDown, Upload, FileSpreadsheet, Download,
  Layers, Plus, Minus, ChevronsRight, Info, PlayCircle,
} from 'lucide-react';

interface Campaign {
  id: string;
  name: string;
  status: string;
}

interface ResearchEntry {
  id: string;
  status: string;
  campaign_id: string;
  campaign_name: string;
  target_lead_ids: string | null;
  started_at: string | null;
  completed_at: string | null;
  estimated_cost: number;
  lead_count: number;
  error_message: string | null;
  created_at: string;
  triggered_by_name: string | null;
  steps_run: string | null;
  run_type: string;
  lead: {
    id: string;
    company_name: string;
    domain: string;
    fit_score: number | null;
    fit_score_label: string | null;
    segment: string | null;
  } | null;
  batch_leads: Array<{
    id: string;
    company_name: string;
    domain: string;
    fit_score: number | null;
    fit_score_label: string | null;
    segment: string | null;
    lead_status: string | null;
  }> | null;
}

interface ActiveResearch {
  runId: string | null;
  leadId?: string;
  domain?: string;
  domains?: string[];
  leadIds?: string[];
  campaignId: string;
  campaignName: string;
  context?: string;
  status: 'starting' | 'running' | 'completed' | 'failed';
  phase?: string;
  currentCompany?: string;
  stepNumber?: number;
  totalSteps?: number;
  error?: string;
  mode: 'single' | 'batch';
  completedDomains?: Set<string>;
}

interface CSVContext {
  headers: string[];
  rows: Record<string, Record<string, string>>;
  domain_column?: string;
}

function normalizeDomain(input: string): string {
  return input.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/.*$/, '').trim();
}

const DOMAIN_COLUMN_NAMES = ['domain', 'website', 'url', 'company_domain', 'site', 'web'];

function detectDomainColumn(headers: string[]): string | null {
  const lower = headers.map(h => h.toLowerCase().trim());
  for (const name of DOMAIN_COLUMN_NAMES) {
    const idx = lower.indexOf(name);
    if (idx !== -1) return headers[idx];
  }
  return null;
}

function parseCSVLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { cells.push(current.trim()); current = ''; }
      else { current += ch; }
    }
  }
  cells.push(current.trim());
  return cells;
}

export function QuickResearch() {
  const { user } = useAuthContext();
  const [mode, setMode] = useState<'single' | 'batch'>('single');
  const [domain, setDomain] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [context, setContext] = useState('');
  const [forceBrief, setForceBrief] = useState(false);
  const [scoreOnly, setScoreOnly] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState<ActiveResearch | null>(null);
  const [showActiveLog, setShowActiveLog] = useState(true);
  const [history, setHistory] = useState<ResearchEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const [resumingId, setResumingId] = useState<string | null>(null);

  // Batch mode state
  const [batchText, setBatchText] = useState('');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [domainColumn, setDomainColumn] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Priority selection state (for >50 domains)
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  const [showPrioritySelector, setShowPrioritySelector] = useState(false);
  const [remainingPool, setRemainingPool] = useState<string[]>([]);
  const [remainingCsvContext, setRemainingCsvContext] = useState<CSVContext | null>(null);

  const canBulk = permissions.canBulkResearch(user?.role);
  const MAX_BATCH_SIZE = scoreOnly && canBulk ? 10000 : 50;

  const { subscribe } = useEventStream({
    types: [
      'campaign.progress', 'campaign.completed', 'campaign.failed',
      'pipeline.progress', 'pipeline.completed', 'pipeline.failed',
      'lead.stage_rerun', 'run.activity',
    ],
  });

  const loadHistory = useCallback(async () => {
    try {
      const data = await api('/research/history');
      setHistory(data || []);
    } catch {
      // ignore
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  const handleResume = async (entry: ResearchEntry) => {
    if (!entry.campaign_id) return;
    setResumingId(entry.id);
    try {
      const analysis = await api(`/runs/${entry.id}/resume-analysis`) as any;
      if (!analysis.resumable) {
        alert(`Cannot resume: ${analysis.reason}`);
        return;
      }
      const plan = analysis.resume_plan;
      const confirmed = confirm(
        `Resume ${plan.lead_ids.length} leads from ${plan.steps_to_run[0]} stage?\n` +
        `${plan.leads_already_complete} leads already completed.\n` +
        `Steps to run: ${plan.steps_to_run.join(' → ')}`
      );
      if (!confirmed) return;
      await api(`/runs/${entry.id}/resume`, { method: 'POST' });
      loadHistory();
    } catch (err: any) {
      alert(err.message || 'Failed to resume');
    } finally {
      setResumingId(null);
    }
  };

  useEffect(() => {
    api('/campaigns').then((data: any) => {
      const list = (Array.isArray(data) ? data : data.campaigns || [])
        .filter((c: Campaign) => c.status === 'active');
      setCampaigns(list);
      if (list.length === 1) setCampaignId(list[0].id);
    }).catch(() => {});
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    const unsub = subscribe('*', (event: SSEEvent) => {
      if (!active?.runId) return;
      const { type, data } = event;

      if ((type === 'campaign.progress' || type === 'pipeline.progress') && data.run_id === active.runId) {
        setActive(prev => {
          if (!prev) return null;
          const completed = new Set(prev.completedDomains || []);
          if (prev.mode === 'batch' && data.current_company && prev.currentCompany && prev.currentCompany !== data.current_company) {
            completed.add(prev.currentCompany);
          }
          return {
            ...prev,
            status: 'running',
            phase: data.phase,
            currentCompany: data.current_company,
            stepNumber: data.step_number,
            totalSteps: data.total_steps,
            completedDomains: completed,
          };
        });
      }

      if ((type === 'campaign.completed' || type === 'pipeline.completed') && data.run_id === active.runId) {
        setActive(prev => prev ? { ...prev, status: 'completed' } : null);
        loadHistory();
      }

      if ((type === 'campaign.failed' || type === 'pipeline.failed') && data.run_id === active.runId) {
        setActive(prev => prev ? { ...prev, status: 'failed', error: data.error } : null);
        loadHistory();
      }
    });
    return unsub;
  }, [subscribe, active?.runId, loadHistory]);

  // CSV file handling
  function handleCSVFile(f: File) {
    setCsvFile(f);
    setError('');
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) {
        setError('CSV must have at least a header row and one data row');
        setCsvFile(null);
        return;
      }
      const headers = parseCSVLine(lines[0]);
      const dataRows = lines.slice(1).map(l => parseCSVLine(l));
      setCsvHeaders(headers);
      setCsvRows(dataRows);
      const detected = detectDomainColumn(headers);
      setDomainColumn(detected);
      if (!detected) {
        setError('Could not auto-detect domain column. Please select one.');
      }
    };
    reader.readAsText(f);
  }

  function clearCSV() {
    setCsvFile(null);
    setCsvHeaders([]);
    setCsvRows([]);
    setDomainColumn(null);
    setShowPrioritySelector(false);
    setSelectedDomains([]);
  }

  // Parse batch domains from text or CSV
  function getParsedDomains(): { domains: string[]; csvContext: CSVContext | null } {
    if (csvFile && csvHeaders.length > 0 && domainColumn) {
      const colIdx = csvHeaders.indexOf(domainColumn);
      if (colIdx === -1) return { domains: [], csvContext: null };

      const domains: string[] = [];
      const rows: Record<string, Record<string, string>> = {};
      for (const row of csvRows) {
        const raw = row[colIdx];
        if (!raw) continue;
        const norm = normalizeDomain(raw);
        if (norm && norm.includes('.')) {
          domains.push(norm);
          const rowData: Record<string, string> = {};
          csvHeaders.forEach((h, i) => { rowData[h] = row[i] || ''; });
          rows[norm] = rowData;
        }
      }
      return { domains, csvContext: { headers: csvHeaders, rows, domain_column: domainColumn || undefined } };
    }

    // Text mode: split on commas, newlines, semicolons, spaces
    const raw = batchText.split(/[,;\n\r]+/).map(s => s.trim()).filter(Boolean);
    const domains = raw.map(normalizeDomain).filter(d => d && d.includes('.'));
    return { domains, csvContext: null };
  }

  const parsedBatch = mode === 'batch' ? getParsedDomains() : { domains: [], csvContext: null };
  const uniqueBatchDomains = [...new Set(parsedBatch.domains)];
  const batchDuplicates = parsedBatch.domains.length - uniqueBatchDomains.length;

  // Single domain submit
  const handleSingleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeDomain(domain);
    if (!normalized || !normalized.includes('.')) {
      setError('Enter a valid domain (e.g. workday.com)');
      return;
    }
    if (!campaignId) {
      setError('Select a campaign');
      return;
    }

    setSubmitting(true);
    setError('');
    setActive(null);
    setShowActiveLog(true);

    const campaign = campaigns.find(c => c.id === campaignId);

    try {
      const result = await api('/research', {
        method: 'POST',
        body: JSON.stringify({ domain: normalized, campaign_id: campaignId, ...(context.trim() ? { context: context.trim() } : {}) }),
      });
      setActive({
        runId: result.run_id,
        leadId: result.lead_id,
        domain: result.domain,
        campaignId,
        campaignName: campaign?.name || '',
        context: context.trim() || undefined,
        status: 'starting',
        mode: 'single',
      });
      setDomain('');
      setContext('');
    } catch (err: any) {
      setError(err.message || 'Failed to start research');
    } finally {
      setSubmitting(false);
    }
  };

  // Batch submit — handles both direct submit (<=50) and priority-selected submit
  const handleBatchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // If >50 domains and priority selector not yet shown, show it
    if (uniqueBatchDomains.length > MAX_BATCH_SIZE && !showPrioritySelector) {
      setShowPrioritySelector(true);
      setSelectedDomains(uniqueBatchDomains.slice(0, MAX_BATCH_SIZE));
      return;
    }

    const domainsToSubmit = showPrioritySelector ? selectedDomains : uniqueBatchDomains;

    if (domainsToSubmit.length === 0) {
      setError('Select at least one domain to research');
      return;
    }
    if (domainsToSubmit.length > MAX_BATCH_SIZE) {
      setError(`Maximum ${MAX_BATCH_SIZE} domains per batch. Please deselect some.`);
      return;
    }
    if (!campaignId) {
      setError('Select a campaign');
      return;
    }

    setSubmitting(true);
    setError('');
    setActive(null);
    setShowActiveLog(true);

    const campaign = campaigns.find(c => c.id === campaignId);

    // Build csv_context scoped to selected domains only
    // Fall back to remainingCsvContext for subsequent batches after CSV file is cleared
    let sourceCsvContext = parsedBatch.csvContext || remainingCsvContext;
    let scopedCsvContext = sourceCsvContext;
    if (scopedCsvContext && showPrioritySelector) {
      const scopedRows: Record<string, Record<string, string>> = {};
      for (const d of domainsToSubmit) {
        if (scopedCsvContext.rows[d]) scopedRows[d] = scopedCsvContext.rows[d];
      }
      scopedCsvContext = { ...scopedCsvContext, rows: scopedRows };
    }

    try {
      const body: any = {
        domains: domainsToSubmit,
        campaign_id: campaignId,
      };
      if (context.trim()) body.context = context.trim();
      if (scopedCsvContext) body.csv_context = scopedCsvContext;
      if (forceBrief) body.force_brief = true;
      if (scoreOnly) body.score_only = true;

      const result = await api('/research/batch', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      // Stash remaining domains for next batch
      if (showPrioritySelector) {
        const submittedSet = new Set(domainsToSubmit);
        const remaining = uniqueBatchDomains.filter(d => !submittedSet.has(d));
        setRemainingPool(remaining);
        if (sourceCsvContext) {
          const remainingRows: Record<string, Record<string, string>> = {};
          for (const d of remaining) {
            if (sourceCsvContext.rows[d]) remainingRows[d] = sourceCsvContext.rows[d];
          }
          setRemainingCsvContext({ ...sourceCsvContext, rows: remainingRows });
        }
      }

      setActive({
        runId: result.run_id,
        leadIds: result.lead_ids,
        domains: domainsToSubmit,
        campaignId,
        campaignName: campaign?.name || '',
        context: context.trim() || undefined,
        status: 'starting',
        mode: 'batch',
        completedDomains: new Set(),
      });
      setBatchText('');
      clearCSV();
      setContext('');
      setShowPrioritySelector(false);
      setSelectedDomains([]);
    } catch (err: any) {
      setError(err.message || 'Failed to start batch research');
    } finally {
      setSubmitting(false);
    }
  };

  // Load remaining domains into a new batch after completion
  function startNextBatch() {
    const next = remainingPool.slice(0, MAX_BATCH_SIZE);
    const rest = remainingPool.slice(MAX_BATCH_SIZE);

    // Restore remaining pool into batch text so parsedBatch picks it up
    setBatchText(remainingPool.join('\n'));

    if (rest.length > 0) {
      setShowPrioritySelector(true);
      setSelectedDomains(next);
    } else {
      setShowPrioritySelector(false);
      setSelectedDomains([]);
    }

    setActive(null);
    // Keep remainingCsvContext — the next submit will use it for CSV column injection
    setRemainingPool([]);
  }

  const normalized = normalizeDomain(domain);
  const PHASE_LABELS: Record<string, string> = {
    enrichment: 'Enriching',
    scoring: 'Scoring',
    brief_generation: 'Generating Brief',
    audit: 'Auditing',
    research: 'Researching',
  };

  const COL_SPAN = 10;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Research</h1>
        <p className="text-sm text-gray-500">Run the pipeline against companies using an existing campaign's settings.</p>
      </div>

      {/* Mode Toggle */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 w-fit mb-5">
          <button
            onClick={() => { setMode('single'); setError(''); }}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              mode === 'single' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Globe className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
            Single Domain
          </button>
          <button
            onClick={() => { setMode('batch'); setError(''); }}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              mode === 'batch' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Layers className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
            Batch Research
          </button>
        </div>

        {/* Single Domain Form */}
        {mode === 'single' && (
          <form onSubmit={handleSingleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-4 items-end">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company Domain</label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={domain}
                    onChange={e => { setDomain(e.target.value); setError(''); }}
                    placeholder="e.g. workday.com"
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                  />
                </div>
                {domain && normalized && normalized !== domain.toLowerCase().trim() && (
                  <p className="text-xs text-gray-400 mt-1">
                    Will research: <span className="font-mono text-gray-600">{normalized}</span>
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Settings</label>
                <div className="relative">
                  <Target className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <select
                    value={campaignId}
                    onChange={e => { setCampaignId(e.target.value); setError(''); }}
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent appearance-none bg-white"
                  >
                    <option value="">Select campaign...</option>
                    {campaigns.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                type="submit"
                disabled={submitting || !domain.trim() || !campaignId}
                className="flex items-center gap-2 px-5 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Research
              </button>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Additional Context <span className="font-normal text-gray-400">(optional)</span></label>
              <textarea
                value={context}
                onChange={e => setContext(e.target.value)}
                placeholder="e.g. Upcoming call — they mentioned evaluating ZTNA to replace GlobalProtect, ~500 employees, Series B..."
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm resize-y"
              />
            </div>
            <div className="flex items-start gap-2 text-xs text-gray-400">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>Briefs are always generated for single-domain research, even if the score is below the campaign's minimum threshold.</span>
            </div>
            {error && (
              <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 px-4 py-2 rounded-lg">
                <XCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}
          </form>
        )}

        {/* Batch Research Form */}
        {mode === 'batch' && (
          <form onSubmit={handleBatchSubmit} className="space-y-4">
            {/* Domain input: textarea or CSV */}
            {!csvFile ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Domains</label>
                  <textarea
                    value={batchText}
                    onChange={e => { setBatchText(e.target.value); setError(''); setShowPrioritySelector(false); setSelectedDomains([]); }}
                    placeholder="Paste domains separated by commas, newlines, or semicolons:&#10;workday.com, snowflake.com, datadog.com&#10;confluent.io&#10;hashicorp.com"
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm font-mono resize-y"
                  />
                  {uniqueBatchDomains.length > 0 && (
                    <p className="text-xs text-gray-500 mt-1">
                      {uniqueBatchDomains.length} domain{uniqueBatchDomains.length !== 1 ? 's' : ''} detected
                      {batchDuplicates > 0 && <span className="text-amber-600"> ({batchDuplicates} duplicate{batchDuplicates !== 1 ? 's' : ''} removed)</span>}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex-1 border-t border-gray-200" />
                  <span className="text-xs text-gray-400 font-medium">OR</span>
                  <div className="flex-1 border-t border-gray-200" />
                </div>

                <div
                  className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer ${
                    dragActive ? 'border-brand-400 bg-brand-50' : 'border-gray-300 hover:border-brand-300'
                  }`}
                  onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={(e) => { e.preventDefault(); setDragActive(false); if (e.dataTransfer.files[0]) handleCSVFile(e.dataTransfer.files[0]); }}
                  onClick={() => fileRef.current?.click()}
                >
                  <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => { if (e.target.files?.[0]) handleCSVFile(e.target.files[0]); }} />
                  <Upload className="w-6 h-6 text-gray-400 mx-auto mb-1.5" />
                  <p className="text-sm text-gray-600">
                    <span className="font-medium text-brand-600">Upload CSV</span> with a domain column
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Extra columns (contacts, notes) will be preserved in the enriched export
                  </p>
                </div>
              </div>
            ) : (
              /* CSV Preview */
              <div className="space-y-3">
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="w-4 h-4 text-brand-500" />
                      <span className="text-sm font-medium text-gray-900">{csvFile.name}</span>
                      <span className="text-xs text-gray-500">{csvRows.length} row{csvRows.length !== 1 ? 's' : ''}</span>
                    </div>
                    <button type="button" onClick={clearCSV} className="text-xs text-gray-500 hover:text-red-600 transition-colors">
                      Remove
                    </button>
                  </div>

                  {/* Domain column selector */}
                  <div className="px-4 py-3 bg-blue-50 border-b border-blue-100">
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-medium text-blue-700 whitespace-nowrap">Domain column:</label>
                      <select
                        value={domainColumn || ''}
                        onChange={e => { setDomainColumn(e.target.value || null); setError(''); }}
                        className="text-xs px-2 py-1 border border-blue-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-brand-500"
                      >
                        <option value="">Select column...</option>
                        {csvHeaders.map(h => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                      {domainColumn && uniqueBatchDomains.length > 0 && (
                        <span className="text-xs text-blue-600">
                          {uniqueBatchDomains.length} valid domain{uniqueBatchDomains.length !== 1 ? 's' : ''} found
                          {batchDuplicates > 0 && `, ${batchDuplicates} duplicate${batchDuplicates !== 1 ? 's' : ''} removed`}
                        </span>
                      )}
                    </div>
                    {csvHeaders.filter(h => h.toLowerCase() !== domainColumn?.toLowerCase()).length > 0 && domainColumn && (
                      <p className="text-xs text-blue-500 mt-1.5">
                        Additional columns will be preserved in the enriched export: {csvHeaders.filter(h => h !== domainColumn).join(', ')}
                      </p>
                    )}
                  </div>

                  {/* Preview table */}
                  <div className="overflow-x-auto max-h-40">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-100">
                          {csvHeaders.map((h, i) => (
                            <th key={i} className={`px-3 py-2 text-left font-medium ${h === domainColumn ? 'text-brand-600 bg-brand-50' : 'text-gray-500'}`}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {csvRows.slice(0, 5).map((row, i) => (
                          <tr key={i} className="border-b border-gray-50">
                            {row.map((cell, j) => (
                              <td key={j} className={`px-3 py-1.5 max-w-[200px] truncate ${csvHeaders[j] === domainColumn ? 'text-brand-700 font-mono bg-brand-50/50' : 'text-gray-700'}`}>
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {csvRows.length > 5 && (
                    <div className="px-4 py-1.5 text-xs text-gray-400 bg-gray-50 border-t border-gray-100">
                      ...and {csvRows.length - 5} more row{csvRows.length - 5 !== 1 ? 's' : ''}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Priority Selector (shown when >50 domains) */}
            {showPrioritySelector && uniqueBatchDomains.length > MAX_BATCH_SIZE && (
              <PrioritySelector
                allDomains={uniqueBatchDomains}
                selected={selectedDomains}
                onSelectedChange={setSelectedDomains}
                maxSize={MAX_BATCH_SIZE}
              />
            )}

            {/* Campaign selector + context + submit */}
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Settings</label>
                <div className="relative">
                  <Target className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <select
                    value={campaignId}
                    onChange={e => { setCampaignId(e.target.value); setError(''); }}
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent appearance-none bg-white"
                  >
                    <option value="">Select campaign...</option>
                    {campaigns.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                type="submit"
                disabled={submitting || (showPrioritySelector ? selectedDomains.length === 0 : uniqueBatchDomains.length === 0) || !campaignId || (csvFile != null && !domainColumn)}
                className="flex items-center gap-2 px-5 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                {showPrioritySelector
                  ? `Research ${selectedDomains.length} of ${uniqueBatchDomains.length} Domains`
                  : uniqueBatchDomains.length > MAX_BATCH_SIZE
                    ? `Select Priority (${uniqueBatchDomains.length} domains)`
                    : `Research ${uniqueBatchDomains.length > 0 ? `${uniqueBatchDomains.length} Domain${uniqueBatchDomains.length !== 1 ? 's' : ''}` : ''}`
                }
              </button>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Context for All <span className="font-normal text-gray-400">(optional)</span></label>
              <textarea
                value={context}
                onChange={e => setContext(e.target.value)}
                placeholder="e.g. These companies were mentioned in a competitor's case studies..."
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm resize-y"
              />
            </div>
            <label className={`flex items-start gap-2.5 cursor-pointer group ${scoreOnly ? 'opacity-50' : ''}`}>
              <input
                type="checkbox"
                checked={forceBrief}
                disabled={scoreOnly}
                onChange={e => {
                  setForceBrief(e.target.checked);
                  if (e.target.checked) setScoreOnly(false);
                }}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              />
              <div>
                <span className="text-sm text-gray-700 group-hover:text-gray-900 transition-colors">Generate briefs for all leads</span>
                <p className="text-xs text-gray-400 mt-0.5">Overrides the campaign's minimum score threshold — all leads will receive an outreach brief regardless of score.</p>
              </div>
            </label>
            <label className={`flex items-start gap-2.5 cursor-pointer group ${forceBrief ? 'opacity-50' : ''}`}>
              <input
                type="checkbox"
                checked={scoreOnly}
                disabled={forceBrief}
                onChange={e => {
                  setScoreOnly(e.target.checked);
                  if (e.target.checked) setForceBrief(false);
                }}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              />
              <div>
                <span className="text-sm text-gray-700 group-hover:text-gray-900 transition-colors">Score only (skip brief generation)</span>
                <p className="text-xs text-gray-400 mt-0.5">
                  Runs enrichment and scoring only — no Opus briefs.{' '}
                  {canBulk
                    ? 'Supports up to 10,000 domains per batch for large-scale triage.'
                    : 'Saves token cost on brief generation.'}
                </p>
              </div>
            </label>
            {error && (
              <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 px-4 py-2 rounded-lg">
                <XCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}
          </form>
        )}
      </div>

      {/* Active Research Status */}
      {active && active.mode === 'single' && (
        <SingleActivePanel active={active} showLog={showActiveLog} setShowLog={setShowActiveLog} phaseLabels={PHASE_LABELS} />
      )}
      {active && active.mode === 'batch' && (
        <BatchActivePanel active={active} showLog={showActiveLog} setShowLog={setShowActiveLog} phaseLabels={PHASE_LABELS} />
      )}

      {/* Next Batch Prompt */}
      {active?.status === 'completed' && remainingPool.length > 0 && (
        <div className="mb-6 bg-brand-50 border border-brand-200 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ChevronsRight className="w-5 h-5 text-brand-600" />
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {remainingPool.length} domain{remainingPool.length !== 1 ? 's' : ''} remaining
                </p>
                <p className="text-xs text-gray-500">
                  Ready to research the next batch from your upload.
                </p>
              </div>
            </div>
            <button
              onClick={startNextBatch}
              className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 font-medium text-sm transition-colors"
            >
              <Layers className="w-4 h-4" />
              Research Next Batch
            </button>
          </div>
        </div>
      )}

      {/* Research History */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-400" /> Recent Researches
          </h2>
          <button
            onClick={loadHistory}
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 rounded hover:bg-gray-100 transition-colors"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>

        {loadingHistory ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-brand-500" />
          </div>
        ) : history.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
            <Search className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No researches yet. Enter a domain above to get started.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Company</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Campaign</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Score</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Steps</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cost</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">By</th>
                  <th className="px-4 py-3 w-20"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history.map(entry => {
                  const isBatch = entry.run_type === 'batch_research' || entry.run_type === 'webhook_research';
                  return (
                    <HistoryRow
                      key={entry.id}
                      entry={entry}
                      isBatch={isBatch}
                      expandedLog={expandedLogId === entry.id}
                      expandedBatch={expandedBatchId === entry.id}
                      onToggleLog={() => setExpandedLogId(expandedLogId === entry.id ? null : entry.id)}
                      onToggleBatch={() => setExpandedBatchId(expandedBatchId === entry.id ? null : entry.id)}
                      colSpan={COL_SPAN}
                      onResume={() => handleResume(entry)}
                      resuming={resumingId === entry.id}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Single Active Research Panel ─────────────────────────────────

function SingleActivePanel({ active, showLog, setShowLog, phaseLabels }: {
  active: ActiveResearch;
  showLog: boolean;
  setShowLog: (v: boolean) => void;
  phaseLabels: Record<string, string>;
}) {
  return (
    <div className={`rounded-xl border mb-6 overflow-hidden ${
      active.status === 'completed' ? 'bg-emerald-50 border-emerald-200' :
      active.status === 'failed' ? 'bg-red-50 border-red-200' :
      'bg-amber-50 border-amber-200'
    }`}>
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <StatusIcon status={active.status} />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-900">{active.domain}</span>
              <span className="text-xs text-gray-500">via {active.campaignName}</span>
            </div>
            {active.context && (
              <p className="text-xs text-gray-500 mt-0.5 line-clamp-1" title={active.context}>
                Context: "{active.context}"
              </p>
            )}
            <PhaseDisplay active={active} phaseLabels={phaseLabels} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowLog(!showLog)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:text-gray-800 bg-white/70 rounded-lg border border-gray-200 hover:bg-white transition-colors"
          >
            <Eye className="w-3 h-3" />
            {showLog ? 'Hide Log' : 'Show Log'}
          </button>
          {active.leadId && (
            <Link
              to={`/leads/${active.leadId}`}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-brand-600 hover:text-brand-700 bg-white rounded-lg border border-gray-200 hover:border-brand-200 transition-colors"
            >
              View Lead
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>
      </div>
      {showLog && active.runId && (
        <div className="border-t border-gray-200/50">
          <ActivityPanel runId={active.runId} />
        </div>
      )}
    </div>
  );
}

// ── Batch Active Research Panel ──────────────────────────────────

function BatchActivePanel({ active, showLog, setShowLog, phaseLabels }: {
  active: ActiveResearch;
  showLog: boolean;
  setShowLog: (v: boolean) => void;
  phaseLabels: Record<string, string>;
}) {
  const totalDomains = active.domains?.length || 0;
  const completedCount = (active.completedDomains?.size || 0) + (active.status === 'completed' ? totalDomains - (active.completedDomains?.size || 0) : 0);
  const progressPct = totalDomains > 0 ? Math.round((completedCount / totalDomains) * 100) : 0;

  return (
    <div className={`rounded-xl border mb-6 overflow-hidden ${
      active.status === 'completed' ? 'bg-emerald-50 border-emerald-200' :
      active.status === 'failed' ? 'bg-red-50 border-red-200' :
      'bg-amber-50 border-amber-200'
    }`}>
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <StatusIcon status={active.status} />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-900">Batch Research</span>
                <span className="text-xs text-gray-500">{totalDomains} domains via {active.campaignName}</span>
              </div>
              <PhaseDisplay active={active} phaseLabels={phaseLabels} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowLog(!showLog)}
              className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:text-gray-800 bg-white/70 rounded-lg border border-gray-200 hover:bg-white transition-colors"
            >
              <Eye className="w-3 h-3" />
              {showLog ? 'Hide Log' : 'Show Log'}
            </button>
            {active.status === 'completed' && active.runId && (
              <button
                onClick={() => downloadFile(`/research/batch/${active.runId}/export`, `signalstack-batch-${new Date().toISOString().split('T')[0]}.csv`)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:text-emerald-800 bg-white rounded-lg border border-emerald-200 hover:border-emerald-300 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Download CSV
              </button>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="bg-white/60 rounded-full h-2 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              active.status === 'completed' ? 'bg-emerald-500' :
              active.status === 'failed' ? 'bg-red-500' :
              'bg-amber-500'
            }`}
            style={{ width: `${active.status === 'completed' ? 100 : progressPct}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-xs text-gray-600">
            {active.status === 'completed' ? `${totalDomains} of ${totalDomains}` : `${completedCount} of ${totalDomains}`} domains processed
          </span>
          {active.currentCompany && active.status === 'running' && (
            <span className="text-xs text-amber-700">
              Currently: {active.currentCompany}
            </span>
          )}
        </div>

        {/* Per-domain status list */}
        {active.domains && active.domains.length > 0 && (
          <div className="mt-3 bg-white/50 rounded-lg border border-gray-200/50 max-h-48 overflow-y-auto">
            <div className="divide-y divide-gray-100">
              {active.domains.map(d => {
                const isCompleted = active.status === 'completed' || active.completedDomains?.has(d);
                const isCurrent = active.currentCompany?.toLowerCase().includes(d.split('.')[0]) || active.currentCompany === d;
                return (
                  <div key={d} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                    {isCompleted ? (
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    ) : isCurrent ? (
                      <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin shrink-0" />
                    ) : (
                      <div className="w-3.5 h-3.5 rounded-full border border-gray-300 shrink-0" />
                    )}
                    <span className={`font-mono ${isCompleted ? 'text-gray-500' : isCurrent ? 'text-amber-700 font-medium' : 'text-gray-400'}`}>
                      {d}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {showLog && active.runId && (
        <div className="border-t border-gray-200/50">
          <ActivityPanel runId={active.runId} />
        </div>
      )}
    </div>
  );
}

// ── Shared Components ────────────────────────────────────────────

function StatusIcon({ status }: { status: string }) {
  if (status === 'completed') return <CheckCircle className="w-5 h-5 text-emerald-600" />;
  if (status === 'failed') return <XCircle className="w-5 h-5 text-red-600" />;
  return <Loader2 className="w-5 h-5 text-amber-600 animate-spin" />;
}

function PhaseDisplay({ active, phaseLabels }: { active: ActiveResearch; phaseLabels: Record<string, string> }) {
  if (active.status === 'starting') return <p className="text-xs text-amber-700">Starting pipeline...</p>;
  if (active.status === 'running' && active.phase) {
    return (
      <div className="flex items-center gap-2 mt-0.5">
        <p className="text-xs text-amber-700 font-medium">
          {phaseLabels[active.phase] || active.phase}
          {active.mode === 'single' && active.currentCompany ? ` — ${active.currentCompany}` : ''}
        </p>
        {active.stepNumber != null && active.totalSteps != null && (
          <span className="text-[10px] text-amber-600">
            {active.stepNumber}/{active.totalSteps}
          </span>
        )}
      </div>
    );
  }
  if (active.status === 'completed') return <p className="text-xs text-emerald-700">Research complete</p>;
  if (active.status === 'failed') return <p className="text-xs text-red-700">{active.error || 'Research failed'}</p>;
  return null;
}

// ── History Row ──────────────────────────────────────────────────

const STEP_LABELS: Record<string, { label: string; color: string }> = {
  enrich: { label: 'E', color: 'bg-blue-100 text-blue-700' },
  score: { label: 'S', color: 'bg-amber-100 text-amber-700' },
  brief: { label: 'B', color: 'bg-purple-100 text-purple-700' },
  audit: { label: 'A', color: 'bg-emerald-100 text-emerald-700' },
  discover: { label: 'D', color: 'bg-cyan-100 text-cyan-700' },
  qualify: { label: 'Q', color: 'bg-gray-100 text-gray-600' },
};

function StepsPills({ stepsRun }: { stepsRun: string | null }) {
  if (!stepsRun) return <span className="text-xs text-gray-400">-</span>;
  try {
    const steps: string[] = JSON.parse(stepsRun);
    return (
      <div className="flex items-center gap-0.5">
        {steps.map(step => {
          const info = STEP_LABELS[step] || { label: step[0]?.toUpperCase() || '?', color: 'bg-gray-100 text-gray-600' };
          return (
            <span
              key={step}
              className={`w-5 h-5 flex items-center justify-center text-[10px] font-bold rounded ${info.color}`}
              title={step}
            >
              {info.label}
            </span>
          );
        })}
      </div>
    );
  } catch {
    return <span className="text-xs text-gray-400">-</span>;
  }
}

function HistoryRow({ entry, isBatch, expandedLog, expandedBatch, onToggleLog, onToggleBatch, colSpan, onResume, resuming }: {
  entry: ResearchEntry;
  isBatch: boolean;
  expandedLog: boolean;
  expandedBatch: boolean;
  onToggleLog: () => void;
  onToggleBatch: () => void;
  colSpan: number;
  onResume: () => void;
  resuming: boolean;
}) {
  const isRunning = entry.status === 'running' || entry.status === 'pending';
  const isFailed = entry.status === 'failed';
  const isCancelled = entry.status === 'cancelled';
  const canResume = (isFailed || isCancelled) && entry.campaign_id;
  const batchCount = entry.batch_leads?.length || 0;

  return (
    <>
      <tr className={`hover:bg-gray-50 ${isFailed ? 'bg-red-50/30' : ''}`}>
        {/* Type */}
        <td className="px-4 py-3">
          {isBatch ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full">
              <Layers className="w-3 h-3" />
              Batch ({batchCount})
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">
              <Globe className="w-3 h-3" />
              Single
            </span>
          )}
        </td>
        {/* Company */}
        <td className="px-4 py-3">
          {isBatch ? (
            <button onClick={onToggleBatch} className="text-left group">
              <span className="text-sm font-medium text-gray-900 group-hover:text-brand-600">
                {batchCount} domain{batchCount !== 1 ? 's' : ''}
              </span>
              <span className="block text-xs text-gray-400">
                {entry.batch_leads?.slice(0, 3).map(l => l.domain).join(', ')}
                {batchCount > 3 ? '...' : ''}
              </span>
            </button>
          ) : entry.lead ? (
            <Link to={`/leads/${entry.lead.id}`} className="group">
              <span className="text-sm font-medium text-gray-900 group-hover:text-brand-600">
                {entry.lead.company_name}
              </span>
              <span className="block text-xs text-gray-400 font-mono">{entry.lead.domain}</span>
            </Link>
          ) : (
            <span className="text-sm text-gray-400">-</span>
          )}
        </td>
        {/* Campaign */}
        <td className="px-4 py-3">
          {entry.campaign_name ? (
            <Link to={`/campaigns/${entry.campaign_id}`} className="text-xs text-brand-600 hover:text-brand-700 font-medium">
              {entry.campaign_name}
            </Link>
          ) : (
            <span className="text-xs text-gray-400">-</span>
          )}
        </td>
        {/* Score */}
        <td className="px-4 py-3">
          {isBatch ? (
            entry.batch_leads && entry.batch_leads.some(l => l.fit_score != null) ? (
              <span className="text-xs text-gray-600">
                avg {Math.round(entry.batch_leads.filter(l => l.fit_score != null).reduce((s, l) => s + (l.fit_score || 0), 0) / entry.batch_leads.filter(l => l.fit_score != null).length)}
              </span>
            ) : (
              <span className="text-xs text-gray-400">{isRunning ? '...' : '-'}</span>
            )
          ) : entry.lead?.fit_score != null ? (
            <ScoreBadge score={entry.lead.fit_score} />
          ) : (
            <span className="text-xs text-gray-400">{isRunning ? '...' : '-'}</span>
          )}
        </td>
        {/* Steps */}
        <td className="px-4 py-3">
          <StepsPills stepsRun={entry.steps_run} />
        </td>
        {/* Status */}
        <td className="px-4 py-3">
          <StatusBadge status={entry.status} error={entry.error_message} />
        </td>
        {/* Cost */}
        <td className="px-4 py-3 text-xs text-gray-500">
          {entry.estimated_cost > 0 ? `$${entry.estimated_cost.toFixed(2)}` : '-'}
        </td>
        {/* Date */}
        <td className="px-4 py-3 text-xs text-gray-500" title={formatDateTime(entry.created_at)}>
          {timeAgo(entry.created_at)}
        </td>
        {/* By */}
        <td className="px-4 py-3 text-xs text-gray-500">
          {entry.triggered_by_name || 'System'}
        </td>
        {/* Actions */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-1">
            <button
              onClick={onToggleLog}
              className={`p-1 rounded hover:bg-gray-100 transition-colors ${expandedLog ? 'text-brand-600' : 'text-gray-400 hover:text-gray-600'}`}
              title="View activity log"
            >
              <Eye className="w-3.5 h-3.5" />
            </button>
            {canResume && (
              <button
                onClick={onResume}
                disabled={resuming}
                className="p-1 rounded hover:bg-green-50 text-gray-400 hover:text-green-600 transition-colors"
                title="Resume from where it stopped"
              >
                <PlayCircle className={`w-3.5 h-3.5 ${resuming ? 'animate-pulse' : ''}`} />
              </button>
            )}
            <Link to={`/runs/${entry.id}`} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-brand-600 inline-flex" title="View run details">
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
            {isBatch && entry.status === 'completed' && (
              <button
                onClick={() => downloadFile(`/research/batch/${entry.id}/export`, `signalstack-batch-${new Date().toISOString().split('T')[0]}.csv`)}
                className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-emerald-600 transition-colors"
                title="Download enriched CSV"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
            )}
            {!isBatch && entry.lead && (
              <Link to={`/leads/${entry.lead.id}`} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-brand-600 inline-flex">
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            )}
            {expandedLog || expandedBatch ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
          </div>
        </td>
      </tr>
      {/* Expanded batch leads */}
      {expandedBatch && isBatch && entry.batch_leads && (
        <tr>
          <td colSpan={colSpan} className="px-0 py-0 bg-purple-50/30">
            <div className="px-6 py-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {entry.batch_leads.map(lead => (
                  <Link
                    key={lead.id}
                    to={`/leads/${lead.id}`}
                    className="flex items-center gap-3 px-3 py-2 bg-white rounded-lg border border-gray-200 hover:border-brand-200 transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 group-hover:text-brand-600 truncate">{lead.company_name}</p>
                      <p className="text-xs text-gray-400 font-mono truncate">{lead.domain}</p>
                    </div>
                    {lead.fit_score != null && <ScoreBadge score={lead.fit_score} />}
                  </Link>
                ))}
              </div>
            </div>
          </td>
        </tr>
      )}
      {/* Expanded activity log */}
      {expandedLog && (
        <tr>
          <td colSpan={colSpan} className="px-0 py-0 bg-gray-50">
            <ActivityPanel runId={entry.id} onClose={onToggleLog} />
          </td>
        </tr>
      )}
    </>
  );
}

// ── Priority Selector (>50 domains) ─────────────────────────────

function PrioritySelector({ allDomains, selected, onSelectedChange, maxSize }: {
  allDomains: string[];
  selected: string[];
  onSelectedChange: (domains: string[]) => void;
  maxSize: number;
}) {
  const selectedSet = new Set(selected);
  const remaining = allDomains.filter(d => !selectedSet.has(d));
  const isFull = selected.length >= maxSize;

  function addDomain(d: string) {
    if (isFull) return;
    onSelectedChange([...selected, d]);
  }

  function removeDomain(d: string) {
    onSelectedChange(selected.filter(x => x !== d));
  }

  function selectTopN() {
    onSelectedChange(allDomains.slice(0, maxSize));
  }

  function clearAll() {
    onSelectedChange([]);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 px-3 py-2.5 bg-blue-50 rounded-lg border border-blue-100">
        <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
        <p className="text-xs text-blue-700">
          Your list has <span className="font-semibold">{allDomains.length}</span> domains.
          Select up to {maxSize} to research now — you can research the rest after this batch completes.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button type="button" onClick={selectTopN} className="text-xs px-3 py-1.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 font-medium transition-colors">
          Select Top {maxSize}
        </button>
        <button type="button" onClick={clearAll} className="text-xs px-3 py-1.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-500 transition-colors">
          Clear All
        </button>
        <span className={`ml-auto text-xs font-medium ${isFull ? 'text-amber-600' : 'text-gray-500'}`}>
          {selected.length}/{maxSize} selected
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Selected column */}
        <div className="bg-white rounded-xl border border-emerald-200 overflow-hidden">
          <div className="px-3 py-2 bg-emerald-50 border-b border-emerald-100">
            <h4 className="text-xs font-semibold text-emerald-800">
              Selected ({selected.length})
            </h4>
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-gray-50">
            {selected.length === 0 ? (
              <p className="px-3 py-4 text-xs text-gray-400 text-center">
                Click domains on the right to add them
              </p>
            ) : (
              selected.map((d, i) => (
                <div key={d} className="flex items-center gap-2 px-3 py-1.5 hover:bg-red-50/50 group">
                  <span className="text-[10px] font-mono text-gray-400 w-5 text-right">{i + 1}.</span>
                  <span className="flex-1 text-xs font-mono text-gray-800 truncate">{d}</span>
                  <button type="button" onClick={() => removeDomain(d)} className="p-0.5 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                    <Minus className="w-3 h-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Remaining column */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
            <h4 className="text-xs font-semibold text-gray-600">
              Remaining ({remaining.length})
            </h4>
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-gray-50">
            {remaining.length === 0 ? (
              <p className="px-3 py-4 text-xs text-gray-400 text-center">
                All domains selected
              </p>
            ) : (
              remaining.map(d => (
                <div key={d} className="flex items-center gap-2 px-3 py-1.5 hover:bg-emerald-50/50 group">
                  <span className="flex-1 text-xs font-mono text-gray-500 truncate">{d}</span>
                  <button
                    type="button"
                    onClick={() => addDomain(d)}
                    disabled={isFull}
                    className="p-0.5 text-gray-300 hover:text-emerald-500 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-0"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status, error }: { status: string; error: string | null }) {
  if (status === 'running' || status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
        <Loader2 className="w-3 h-3 animate-spin" />
        Running
      </span>
    );
  }
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
        <CheckCircle className="w-3 h-3" />
        Done
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 px-2 py-0.5 rounded-full" title={error || undefined}>
        <XCircle className="w-3 h-3" />
        Failed
      </span>
    );
  }
  return <span className="text-xs text-gray-400">{status}</span>;
}
