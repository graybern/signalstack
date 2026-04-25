import { useState, useEffect } from 'react';
import { api, downloadFile } from '../api/client';
import {
  Download, FileText, FileSpreadsheet, Rss, Settings, Plus, Trash2,
  CheckSquare, Square, Loader2, Eye, X, ExternalLink, Webhook, Copy,
  CheckCircle,
} from 'lucide-react';

type Tab = 'manual' | 'pipelines' | 'api';

interface ExportPipeline {
  id: string;
  name: string;
  webhook_url: string;
  events: string[];
  field_mapping: any;
  filters: any;
  schedule_cron: string | null;
  schedule_enabled: number;
  active: number;
  created_at: string;
}

const ALL_EXPORT_FIELDS = [
  { key: 'company_name', label: 'Company Name', default: true },
  { key: 'domain', label: 'Domain', default: true },
  { key: 'segment', label: 'Segment', default: true },
  { key: 'fit_score', label: 'Fit Score', default: true },
  { key: 'fit_score_label', label: 'Score Label', default: true },
  { key: 'confidence', label: 'Confidence', default: false },
  { key: 'hq_location', label: 'HQ Location', default: true },
  { key: 'employee_count', label: 'Employees', default: true },
  { key: 'founded_year', label: 'Founded', default: false },
  { key: 'funding_stage', label: 'Funding Stage', default: false },
  { key: 'total_funding', label: 'Total Funding', default: false },
  { key: 'current_feedback', label: 'Feedback', default: true },
  { key: 'next_outreach_date', label: 'Next Outreach', default: false },
  { key: 'signal_count', label: 'Signal Count', default: true },
  { key: 'campaign_name', label: 'Campaign', default: true },
  { key: 'created_at', label: 'Date', default: true },
];

export function ExportPage() {
  const [tab, setTab] = useState<Tab>('manual');

  const tabs: { key: Tab; label: string; icon: typeof Download }[] = [
    { key: 'manual', label: 'Manual Export', icon: Download },
    { key: 'pipelines', label: 'Export Pipelines', icon: Webhook },
    { key: 'api', label: 'API Reference', icon: ExternalLink },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Export</h1>
        <p className="text-sm text-gray-500">Export leads, configure outbound pipelines, and access API documentation.</p>
      </div>

      <div className="flex border-b border-gray-200 mb-6">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key ? 'border-brand-500 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'manual' && <ManualExportTab />}
      {tab === 'pipelines' && <ExportPipelinesTab />}
      {tab === 'api' && <ApiReferenceTab />}
    </div>
  );
}

// ── Manual Export Tab ──────────────────────────────────────────

function ManualExportTab() {
  const [selectedFields, setSelectedFields] = useState<string[]>(
    ALL_EXPORT_FIELDS.filter(f => f.default).map(f => f.key)
  );
  const [format, setFormat] = useState<'csv' | 'json' | 'markdown'>('csv');
  const [filters, setFilters] = useState({ campaign_id: '', segment: '', min_score: '', max_score: '', date_from: '', date_to: '' });
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [preview, setPreview] = useState<any[] | null>(null);
  const [previewCount, setPreviewCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    api('/campaigns').then(data => setCampaigns(Array.isArray(data) ? data : [])).catch(() => {});
  }, []);

  const toggleField = (key: string) => {
    setSelectedFields(prev =>
      prev.includes(key) ? prev.filter(f => f !== key) : [...prev, key]
    );
    setPreview(null);
  };

  const selectAll = () => setSelectedFields(ALL_EXPORT_FIELDS.map(f => f.key));
  const selectNone = () => setSelectedFields(['company_name']); // at least one

  const buildFilters = () => {
    const f: Record<string, any> = {};
    if (filters.campaign_id) f.campaign_id = filters.campaign_id;
    if (filters.segment) f.segment = filters.segment;
    if (filters.min_score) f.min_score = parseInt(filters.min_score);
    if (filters.max_score) f.max_score = parseInt(filters.max_score);
    if (filters.date_from) f.date_from = filters.date_from;
    if (filters.date_to) f.date_to = filters.date_to;
    return f;
  };

  const handlePreview = async () => {
    setLoading(true);
    try {
      const result = await api('/exports/custom', {
        method: 'POST',
        body: JSON.stringify({ format: 'json', fields: selectedFields, filters: buildFilters() }),
      });
      setPreview((result as any).leads?.slice(0, 10) || []);
      setPreviewCount((result as any).count || 0);
    } catch (err: any) {
      alert(err.message || 'Preview failed');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const result = await api('/exports/custom', {
        method: 'POST',
        body: JSON.stringify({ format, fields: selectedFields, filters: buildFilters() }),
      });

      if (format === 'json') {
        const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
        downloadBlob(blob, `leads-export-${new Date().toISOString().slice(0, 10)}.json`);
      } else {
        // For CSV/Markdown, re-request with proper content type handling
        const res = await fetch('/api/exports/custom', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
          body: JSON.stringify({ format, fields: selectedFields, filters: buildFilters() }),
        });
        const blob = await res.blob();
        const ext = format === 'csv' ? 'csv' : 'md';
        downloadBlob(blob, `leads-export-${new Date().toISOString().slice(0, 10)}.${ext}`);
      }
    } catch (err: any) {
      alert(err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Quick exports */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Quick Export</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <QuickExportCard
            title="Salesforce CSV"
            description="Summary format ready for SF Data Import Wizard"
            icon={<FileSpreadsheet className="w-5 h-5 text-emerald-600" />}
            onDownload={() => downloadFile('/exports/csv/summary', 'signalstack-summary.csv')}
          />
          <QuickExportCard
            title="Detailed CSV"
            description="Complete lead data with personas and tech stack"
            icon={<FileSpreadsheet className="w-5 h-5 text-blue-600" />}
            onDownload={() => downloadFile('/exports/csv/detailed', 'signalstack-detailed.csv')}
          />
          <QuickExportCard
            title="RSS Feed"
            description="Subscribe to pipeline intelligence updates"
            icon={<Rss className="w-5 h-5 text-orange-500" />}
            onDownload={() => window.open('/api/exports/rss', '_blank')}
            buttonLabel="Open Feed"
          />
        </div>
      </div>

      {/* Custom export builder */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Custom Export</h3>

        {/* Format selector */}
        <div className="mb-4">
          <label className="text-xs text-gray-500 block mb-2">Format</label>
          <div className="flex gap-2">
            {(['csv', 'json', 'markdown'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={`px-3 py-1.5 text-sm rounded-lg border ${
                  format === f ? 'bg-brand-50 border-brand-200 text-brand-700 font-medium' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="mb-4">
          <label className="text-xs text-gray-500 block mb-2">Filters</label>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            <select value={filters.campaign_id} onChange={e => setFilters({ ...filters, campaign_id: e.target.value })} className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white">
              <option value="">All Campaigns</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={filters.segment} onChange={e => setFilters({ ...filters, segment: e.target.value })} className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white">
              <option value="">All Segments</option>
              <option value="ENT">Enterprise</option>
              <option value="MM">Mid-Market</option>
              <option value="SMB">SMB</option>
            </select>
            <input type="number" placeholder="Min Score" value={filters.min_score} onChange={e => setFilters({ ...filters, min_score: e.target.value })} className="px-3 py-2 text-sm border border-gray-300 rounded-lg" />
            <input type="number" placeholder="Max Score" value={filters.max_score} onChange={e => setFilters({ ...filters, max_score: e.target.value })} className="px-3 py-2 text-sm border border-gray-300 rounded-lg" />
            <input type="date" title="From date" value={filters.date_from} onChange={e => setFilters({ ...filters, date_from: e.target.value })} className="px-3 py-2 text-sm border border-gray-300 rounded-lg" />
            <input type="date" title="To date" value={filters.date_to} onChange={e => setFilters({ ...filters, date_to: e.target.value })} className="px-3 py-2 text-sm border border-gray-300 rounded-lg" />
          </div>
        </div>

        {/* Field picker */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-gray-500">Fields ({selectedFields.length} selected)</label>
            <div className="flex gap-2">
              <button onClick={selectAll} className="text-xs text-brand-600 hover:text-brand-700">Select All</button>
              <button onClick={selectNone} className="text-xs text-gray-400 hover:text-gray-600">Reset</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {ALL_EXPORT_FIELDS.map(f => (
              <button
                key={f.key}
                onClick={() => toggleField(f.key)}
                className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                  selectedFields.includes(f.key)
                    ? 'bg-brand-50 border-brand-200 text-brand-700 font-medium'
                    : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                {selectedFields.includes(f.key) ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button onClick={handlePreview} disabled={loading} className="flex items-center gap-2 px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
            Preview
          </button>
          <button onClick={handleExport} disabled={exporting || selectedFields.length === 0} className="flex items-center gap-2 px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 font-medium">
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Export {format.toUpperCase()}
          </button>
        </div>

        {/* Preview table */}
        {preview && (
          <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex items-center justify-between">
              <span className="text-xs text-gray-500">Preview — showing {preview.length} of {previewCount} leads</span>
              <button onClick={() => setPreview(null)} className="text-xs text-gray-400 hover:text-gray-600"><X className="w-3 h-3" /></button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100">
                    {selectedFields.map(f => (
                      <th key={f} className="px-3 py-2 text-left font-medium text-gray-500 whitespace-nowrap">{f.replace(/_/g, ' ')}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      {selectedFields.map(f => (
                        <td key={f} className="px-3 py-2 text-gray-700 max-w-[200px] truncate">{row[f] ?? '—'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Segment briefs */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Segment Briefs</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {['ENT', 'MM', 'SMB'].map(seg => (
            <QuickExportCard
              key={seg}
              title={`${seg} Brief`}
              description={`Markdown document with full ${seg} lead briefs`}
              icon={<FileText className="w-5 h-5 text-purple-600" />}
              onDownload={() => downloadFile(`/exports/markdown/${seg}`, `signalstack-${seg}.md`)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Export Pipelines Tab ─────────────────────────────────────

function ExportPipelinesTab() {
  const [pipelines, setPipelines] = useState<ExportPipeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formEvents, setFormEvents] = useState<string[]>(['lead.created']);
  const [formCron, setFormCron] = useState('');
  const [formFieldMapping, setFormFieldMapping] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const availableEvents = ['lead.created', 'lead.scored', 'campaign.completed', 'lead.status_changed'];

  const loadPipelines = async () => {
    try {
      const data = await api('/exports/pipelines');
      setPipelines(Array.isArray(data) ? data : []);
    } catch { }
    finally { setLoading(false); }
  };

  useEffect(() => { loadPipelines(); }, []);

  const handleCreate = async () => {
    if (!formName || !formUrl) return;
    setSaving(true);
    try {
      await api('/exports/pipelines', {
        method: 'POST',
        body: JSON.stringify({
          name: formName,
          webhook_url: formUrl,
          events: formEvents,
          field_mapping: formFieldMapping.length > 0 ? { fields: formFieldMapping } : null,
          schedule_cron: formCron || null,
        }),
      });
      setFormName(''); setFormUrl(''); setFormEvents(['lead.created']); setFormCron(''); setFormFieldMapping([]);
      setShowNew(false);
      loadPipelines();
    } catch (err: any) {
      alert(err.message || 'Failed to create pipeline');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (id: string, active: boolean) => {
    try {
      await api(`/exports/pipelines/${id}`, { method: 'PUT', body: JSON.stringify({ active }) });
      loadPipelines();
    } catch (err: any) {
      alert(err.message || 'Failed to update');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this pipeline?')) return;
    try {
      await api(`/exports/pipelines/${id}`, { method: 'DELETE' });
      loadPipelines();
    } catch (err: any) {
      alert(err.message || 'Failed to delete');
    }
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-brand-500" /></div>;

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
        <p className="text-sm text-blue-700">
          Export pipelines automatically send lead data to external systems via webhooks when events occur.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Pipelines ({pipelines.length})</h3>
        <button
          onClick={() => setShowNew(!showNew)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700"
        >
          {showNew ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {showNew ? 'Cancel' : 'New Pipeline'}
        </button>
      </div>

      {showNew && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Pipeline Name *</label>
              <input value={formName} onChange={e => setFormName(e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" placeholder="e.g., Salesforce Sync" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Webhook URL *</label>
              <input value={formUrl} onChange={e => setFormUrl(e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" placeholder="https://hooks.example.com/..." />
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 block mb-2">Trigger Events</label>
            <div className="flex gap-2">
              {availableEvents.map(evt => (
                <button
                  key={evt}
                  onClick={() => setFormEvents(prev =>
                    prev.includes(evt) ? prev.filter(e => e !== evt) : [...prev, evt]
                  )}
                  className={`px-2.5 py-1 text-xs rounded-lg border ${
                    formEvents.includes(evt) ? 'bg-brand-50 border-brand-200 text-brand-700 font-medium' : 'bg-white border-gray-200 text-gray-500'
                  }`}
                >
                  {evt}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 block mb-1">Schedule (optional cron)</label>
            <input value={formCron} onChange={e => setFormCron(e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg max-w-xs" placeholder="e.g., 0 9 * * 1 (Mondays 9am)" />
          </div>

          <div>
            <label className="text-xs text-gray-500 block mb-2">Field Mapping (leave empty to send all fields)</label>
            <div className="flex flex-wrap gap-1.5">
              {ALL_EXPORT_FIELDS.map(f => (
                <button
                  key={f.key}
                  onClick={() => setFormFieldMapping(prev =>
                    prev.includes(f.key) ? prev.filter(x => x !== f.key) : [...prev, f.key]
                  )}
                  className={`px-2 py-0.5 text-[11px] rounded border transition-colors ${
                    formFieldMapping.includes(f.key)
                      ? 'bg-brand-50 border-brand-200 text-brand-700 font-medium'
                      : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <button onClick={handleCreate} disabled={!formName || !formUrl || saving} className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Create Pipeline
          </button>
        </div>
      )}

      {pipelines.length === 0 && !showNew ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <Webhook className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">No export pipelines configured. Create one to auto-send leads to external systems.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pipelines.map(p => (
            <div key={p.id} className="bg-white border border-gray-200 rounded-lg p-4 flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="text-sm font-medium text-gray-900">{p.name}</h4>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${p.active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    {p.active ? 'Active' : 'Paused'}
                  </span>
                </div>
                <p className="text-xs text-gray-500 truncate">{p.webhook_url}</p>
                <div className="flex gap-1.5 mt-1">
                  {p.events.map(e => (
                    <span key={e} className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">{e}</span>
                  ))}
                  {p.schedule_cron && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded font-mono">{p.schedule_cron}</span>
                  )}
                  {p.field_mapping?.fields && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-700 rounded">{p.field_mapping.fields.length} fields</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 ml-4">
                <button
                  onClick={() => toggleActive(p.id, !p.active)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${p.active ? 'bg-brand-600' : 'bg-gray-300'}`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${p.active ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                </button>
                <button onClick={() => handleDelete(p.id)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── API Reference Tab ───────────────────────────────────────

function ApiReferenceTab() {
  const baseUrl = window.location.origin;
  const [copied, setCopied] = useState<string | null>(null);

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const endpoints = [
    { method: 'GET', path: '/api/leads', desc: 'List leads with filters (pagination, segment, campaign, feedback, score)' },
    { method: 'GET', path: '/api/leads/:id', desc: 'Get lead detail with personas and feedback history' },
    { method: 'GET', path: '/api/leads/stats', desc: 'Aggregate lead statistics' },
    { method: 'GET', path: '/api/leads/export', desc: 'Export leads as CSV/JSON with field selection' },
    { method: 'POST', path: '/api/leads/:id/feedback', desc: 'Submit feedback (bad_fit, good_fit_response, etc.)' },
    { method: 'GET', path: '/api/campaigns', desc: 'List campaigns' },
    { method: 'GET', path: '/api/campaigns/:id', desc: 'Get campaign detail' },
    { method: 'POST', path: '/api/campaigns/:id/run', desc: 'Trigger campaign run' },
    { method: 'GET', path: '/api/campaigns/:id/config', desc: 'Get merged campaign config' },
    { method: 'GET', path: '/api/runs', desc: 'List pipeline runs' },
    { method: 'POST', path: '/api/inbound/upload', desc: 'Upload CSV for import' },
    { method: 'POST', path: '/api/inbound/webhook', desc: 'Inbound lead webhook (x-api-key auth)' },
    { method: 'POST', path: '/api/inbound/enrich', desc: 'Re-enrich existing leads' },
    { method: 'POST', path: '/api/exports/custom', desc: 'Configurable export (field picker + filters)' },
    { method: 'GET', path: '/api/exports/pipelines', desc: 'List export pipelines' },
    { method: 'GET', path: '/api/analytics/overview', desc: 'Dashboard analytics overview' },
    { method: 'GET', path: '/api/analytics/trends', desc: 'Time-series trend data' },
    { method: 'GET', path: '/api/events/stream', desc: 'SSE real-time events' },
    { method: 'GET', path: '/api/exports/rss', desc: 'RSS feed of pipeline runs' },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Authentication</h3>
        <p className="text-sm text-gray-600 mb-3">
          All API endpoints require a JWT Bearer token obtained from <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">POST /api/auth/login</code>.
          Webhook endpoints use <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">x-api-key</code> header authentication.
        </p>
        <div className="bg-gray-900 rounded-lg p-3">
          <pre className="text-xs text-gray-100">Authorization: Bearer {'<your-jwt-token>'}</pre>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-900">Endpoints</h3>
          <span className="text-xs text-gray-400">Base: {baseUrl}</span>
        </div>
        <div className="space-y-1">
          {endpoints.map(ep => (
            <div key={ep.path + ep.method} className="flex items-center gap-3 py-2 border-b border-gray-50 group">
              <span className={`text-xs font-mono px-1.5 py-0.5 rounded w-12 text-center ${
                ep.method === 'GET' ? 'bg-green-50 text-green-700' : ep.method === 'POST' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'
              }`}>{ep.method}</span>
              <code className="text-xs text-gray-700 font-mono flex-1">{ep.path}</code>
              <span className="text-xs text-gray-400 hidden sm:block">{ep.desc}</span>
              <button
                onClick={() => copyText(`${baseUrl}${ep.path}`, ep.path)}
                className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-gray-600"
              >
                {copied === ep.path ? <CheckCircle className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Rate Limits</h3>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div className="border border-gray-200 rounded-lg p-3">
            <p className="font-medium text-gray-900">General API</p>
            <p className="text-gray-500 text-xs mt-1">100 requests / minute</p>
          </div>
          <div className="border border-gray-200 rounded-lg p-3">
            <p className="font-medium text-gray-900">Webhook Inbound</p>
            <p className="text-gray-500 text-xs mt-1">30 requests / minute</p>
          </div>
          <div className="border border-gray-200 rounded-lg p-3">
            <p className="font-medium text-gray-900">Export</p>
            <p className="text-gray-500 text-xs mt-1">10 requests / minute</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Shared Components ───────────────────────────────────────

function QuickExportCard({ title, description, icon, onDownload, buttonLabel = 'Download' }: {
  title: string;
  description: string;
  icon: React.ReactNode;
  onDownload: () => void;
  buttonLabel?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-start gap-3">
      {icon}
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-medium text-gray-900">{title}</h4>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
      </div>
      <button onClick={onDownload} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs hover:bg-gray-200 shrink-0">
        <Download className="w-3 h-3" /> {buttonLabel}
      </button>
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
