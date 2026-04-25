import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api/client';
import { useAuthContext } from '../App';
import { LeadCard } from '../components/LeadCard';
import {
  Upload, Plus, Webhook, FileSpreadsheet, CheckCircle, XCircle, Loader2,
  Clock, ArrowRight, RefreshCw, Beaker, Save, Trash2, X, Copy, Settings,
} from 'lucide-react';

type Tab = 'upload' | 'single' | 'webhook' | 'enrichment';

interface ImportTemplate {
  id: string;
  name: string;
  type: string;
  prompt_template: string | null;
  output_format: any | null;
  source_config: any | null;
  created_at: string;
}

export function Inbound() {
  const { user } = useAuthContext();
  const [tab, setTab] = useState<Tab>('upload');
  const [imports, setImports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedImport, setSelectedImport] = useState<{ import: any; leads: any[] } | null>(null);

  const loadImports = useCallback(async () => {
    try {
      const data = await api('/inbound/imports');
      setImports(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadImports();
    const interval = setInterval(() => { loadImports(); }, 10000);
    return () => clearInterval(interval);
  }, [loadImports]);

  async function viewImport(id: string) {
    const data = await api(`/inbound/imports/${id}`);
    setSelectedImport(data);
  }

  const tabs: { key: Tab; label: string; icon: typeof Upload }[] = [
    { key: 'upload', label: 'CSV Upload', icon: FileSpreadsheet },
    { key: 'single', label: 'Quick Add', icon: Plus },
    { key: 'webhook', label: 'Inbound Webhook', icon: Webhook },
    { key: 'enrichment', label: 'Enrichment Config', icon: Beaker },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Import</h1>
        <p className="text-sm text-gray-500">Import leads from CSV, add manually, receive via webhook, or configure enrichment templates. All leads are enriched, scored, and qualified automatically.</p>
      </div>

      {/* Tab bar */}
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

      {tab === 'upload' && <CSVUploadTab onSuccess={loadImports} />}
      {tab === 'single' && <SingleEntryTab onSuccess={loadImports} />}
      {tab === 'webhook' && <WebhookTab />}
      {tab === 'enrichment' && <EnrichmentConfigTab />}

      {/* Selected import detail */}
      {selectedImport && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Import: {selectedImport.import.filename || 'Manual Entry'}
              </h2>
              <p className="text-sm text-gray-500">
                {selectedImport.leads.length} leads | Status: {selectedImport.import.status}
              </p>
            </div>
            <button onClick={() => setSelectedImport(null)} className="text-sm text-gray-500 hover:text-gray-700">
              Close
            </button>
          </div>
          <div className="grid gap-3">
            {selectedImport.leads.map((lead: any) => (
              <LeadCard key={lead.id} lead={lead} />
            ))}
          </div>
        </div>
      )}

      {/* Import history */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Import History</h2>
          <button onClick={loadImports} className="flex items-center gap-1 text-sm text-gray-500 hover:text-brand-600">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-brand-500" />
          </div>
        ) : imports.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
            <Upload className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No imports yet. Upload a CSV or add leads manually.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">File</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Leads</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Processed</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Qualified</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {imports.map((imp: any) => (
                  <tr key={imp.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3"><SourceTypeBadge type={imp.source_type} /></td>
                    <td className="px-4 py-3 text-gray-900">{imp.filename || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{imp.row_count}</td>
                    <td className="px-4 py-3 text-gray-700">{imp.processed_count}</td>
                    <td className="px-4 py-3"><span className="text-emerald-700 font-medium">{imp.qualified_count}</span></td>
                    <td className="px-4 py-3"><ImportStatusBadge status={imp.status} /></td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{new Date(imp.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => viewImport(imp.id)} className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700">
                        View <ArrowRight className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── CSV Upload Tab ───────────────────────────────────────────────

function CSVUploadTab({ onSuccess }: { onSuccess: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string[][]>([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);

  function handleFile(f: File) {
    setFile(f);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 6);
      const rows = lines.map(l => l.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
      setPreview(rows);
    };
    reader.readAsText(f);
  }

  async function upload() {
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api('/inbound/upload', { method: 'POST', body: formData });
      setResult(res);
      setFile(null);
      setPreview([]);
      onSuccess();
    } catch (err: any) {
      setResult({ error: err.message });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
          dragActive ? 'border-brand-400 bg-brand-50' : 'border-gray-300 hover:border-brand-300'
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => { e.preventDefault(); setDragActive(false); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
        onClick={() => fileRef.current?.click()}
      >
        <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
        <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
        <p className="text-sm text-gray-600">
          <span className="font-medium text-brand-600">Click to upload</span> or drag and drop a CSV file
        </p>
        <p className="text-xs text-gray-400 mt-1">
          Expected columns: company_name (required), domain, segment, contact_name, contact_email, contact_title, notes
        </p>
      </div>

      {preview.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
            <span className="text-sm font-medium text-gray-900">{file?.name}</span>
            <span className="text-xs text-gray-500">{preview.length - 1} rows previewed</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100">
                  {preview[0]?.map((h, i) => (
                    <th key={i} className="px-3 py-2 text-left font-medium text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.slice(1).map((row, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    {row.map((cell, j) => (
                      <td key={j} className="px-3 py-2 text-gray-700 max-w-[200px] truncate">{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 flex justify-end">
            <button onClick={upload} disabled={uploading} className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 text-sm font-medium">
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {uploading ? 'Processing...' : 'Import & Qualify'}
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className={`px-4 py-3 rounded-lg text-sm ${result.error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {result.error ? `Error: ${result.error}` : `Imported ${result.lead_count} leads. Processing in background...`}
        </div>
      )}
    </div>
  );
}

// ── Single Entry Tab ────────────────────────────────────────────

function SingleEntryTab({ onSuccess }: { onSuccess: () => void }) {
  const [form, setForm] = useState({
    company_name: '', domain: '', segment: 'MM',
    contact_name: '', contact_email: '', contact_title: '', notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);

  async function submit() {
    if (!form.company_name) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await api('/inbound/single', { method: 'POST', body: JSON.stringify(form) });
      setResult(res);
      setForm({ company_name: '', domain: '', segment: 'MM', contact_name: '', contact_email: '', contact_title: '', notes: '' });
      onSuccess();
    } catch (err: any) {
      setResult({ error: err.message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">Add a Single Lead</h3>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 sm:col-span-1">
          <label className="text-xs text-gray-500 uppercase font-medium block mb-1">Company Name *</label>
          <input value={form.company_name} onChange={e => setForm({ ...form, company_name: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="Acme Corp" />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="text-xs text-gray-500 uppercase font-medium block mb-1">Domain</label>
          <input value={form.domain} onChange={e => setForm({ ...form, domain: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="acme.com" />
        </div>
        <div>
          <label className="text-xs text-gray-500 uppercase font-medium block mb-1">Segment</label>
          <select value={form.segment} onChange={e => setForm({ ...form, segment: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
            <option value="ENT">Enterprise</option>
            <option value="MM">Mid-Market</option>
            <option value="SMB">SMB</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 uppercase font-medium block mb-1">Contact Name</label>
          <input value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="Jane Smith" />
        </div>
        <div>
          <label className="text-xs text-gray-500 uppercase font-medium block mb-1">Contact Email</label>
          <input value={form.contact_email} onChange={e => setForm({ ...form, contact_email: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="jane@acme.com" />
        </div>
        <div>
          <label className="text-xs text-gray-500 uppercase font-medium block mb-1">Contact Title</label>
          <input value={form.contact_title} onChange={e => setForm({ ...form, contact_title: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="VP of Engineering" />
        </div>
        <div className="col-span-2">
          <label className="text-xs text-gray-500 uppercase font-medium block mb-1">Notes</label>
          <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm h-20 resize-none" placeholder="Met at AWS re:Invent, interested in replacing Cisco VPN..." />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button onClick={submit} disabled={!form.company_name || submitting} className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 text-sm font-medium">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {submitting ? 'Processing...' : 'Add & Qualify'}
        </button>
        {result && (
          <span className={`text-sm ${result.error ? 'text-red-600' : 'text-emerald-600'}`}>
            {result.error ? `Error: ${result.error}` : 'Lead added! Processing in background...'}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Webhook Tab ─────────────────────────────────────────────────

function WebhookTab() {
  const baseUrl = window.location.origin;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-3xl">
      <h3 className="text-sm font-semibold text-gray-900 mb-2">Inbound Webhook</h3>
      <p className="text-sm text-gray-500 mb-6">
        Send leads from external tools (Zapier, HubSpot, Salesforce, event platforms) directly into the enrichment pipeline.
      </p>

      <div className="space-y-4">
        <div>
          <label className="text-xs text-gray-500 uppercase font-medium block mb-1">Endpoint</label>
          <code className="block px-3 py-2 bg-gray-50 rounded-lg text-sm font-mono text-gray-700 select-all">
            POST {baseUrl}/api/inbound/webhook
          </code>
        </div>

        <div>
          <label className="text-xs text-gray-500 uppercase font-medium block mb-1">Authentication</label>
          <p className="text-sm text-gray-600">
            Include an <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">x-api-key</code> header.
            Set the webhook API key in Settings &gt; App Settings.
          </p>
        </div>

        <div>
          <label className="text-xs text-gray-500 uppercase font-medium block mb-2">Example Request</label>
          <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 text-xs overflow-x-auto">
{`curl -X POST ${baseUrl}/api/inbound/webhook \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: YOUR_API_KEY" \\
  -d '[
    {
      "company_name": "Acme Corp",
      "domain": "acme.com",
      "segment": "ENT",
      "contact_name": "Jane Smith",
      "contact_email": "jane@acme.com"
    }
  ]'`}
          </pre>
        </div>

        <div className="border-t border-gray-100 pt-4">
          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Supported Fields</h4>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div><code className="text-brand-600">company_name</code> <span className="text-red-500">*</span> — Company name</div>
            <div><code className="text-brand-600">domain</code> — Company domain</div>
            <div><code className="text-brand-600">segment</code> — ENT, MM, or SMB</div>
            <div><code className="text-brand-600">contact_name</code> — Contact name</div>
            <div><code className="text-brand-600">contact_email</code> — Contact email</div>
            <div><code className="text-brand-600">contact_title</code> — Job title</div>
            <div><code className="text-brand-600">notes</code> — Additional notes</div>
            <div><code className="text-brand-600">source</code> — Lead source</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Enrichment Config Tab ───────────────────────────────────────

function EnrichmentConfigTab() {
  const [templates, setTemplates] = useState<ImportTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ImportTemplate | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // New template form state
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<'inbound' | 'outbound' | 'enrichment'>('enrichment');
  const [formPrompt, setFormPrompt] = useState('');
  const [formFields, setFormFields] = useState<string[]>([
    'company_name', 'domain', 'segment', 'fit_score', 'hq_location', 'employee_count',
  ]);
  const [formSources, setFormSources] = useState<string[]>([]);

  const loadTemplates = async () => {
    try {
      const data = await api('/inbound/templates');
      setTemplates(data);
    } catch { }
    finally { setLoading(false); }
  };

  useEffect(() => { loadTemplates(); }, []);

  const availableFields = [
    'company_name', 'domain', 'segment', 'fit_score', 'fit_score_label', 'confidence',
    'hq_location', 'employee_count', 'founded_year', 'funding_stage', 'total_funding',
    'why_now', 'tech_stack', 'competitive_displacement', 'outreach_strategy',
    'source_citations', 'brief_markdown', 'current_feedback', 'signal_count',
  ];

  const handleSave = async () => {
    if (!formName) return;
    setSaving(true);
    setMessage(null);
    try {
      if (editing) {
        await api(`/inbound/templates/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: formName,
            prompt_template: formPrompt || null,
            output_format: { fields: formFields },
            source_config: { sources: formSources },
          }),
        });
        setMessage({ type: 'success', text: 'Template updated' });
      } else {
        await api('/inbound/templates', {
          method: 'POST',
          body: JSON.stringify({
            name: formName,
            type: formType,
            prompt_template: formPrompt || null,
            output_format: { fields: formFields },
            source_config: { sources: formSources },
          }),
        });
        setMessage({ type: 'success', text: 'Template created' });
      }
      resetForm();
      loadTemplates();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to save' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this template?')) return;
    try {
      await api(`/inbound/templates/${id}`, { method: 'DELETE' });
      loadTemplates();
    } catch (err: any) {
      alert(err.message || 'Failed to delete');
    }
  };

  const startEdit = (t: ImportTemplate) => {
    setEditing(t);
    setShowNew(true);
    setFormName(t.name);
    setFormType(t.type as any);
    setFormPrompt(t.prompt_template || '');
    setFormFields(t.output_format?.fields || []);
    setFormSources(t.source_config?.sources || []);
  };

  const resetForm = () => {
    setEditing(null);
    setShowNew(false);
    setFormName('');
    setFormType('enrichment');
    setFormPrompt('');
    setFormFields(['company_name', 'domain', 'segment', 'fit_score', 'hq_location', 'employee_count']);
    setFormSources([]);
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-brand-500" /></div>;

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
        <p className="text-sm text-blue-700">
          Create reusable enrichment templates with custom prompts and output configurations. Templates can be applied when re-enriching existing leads or processing new imports.
        </p>
      </div>

      {message && (
        <div className={`px-4 py-3 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{message.text}</div>
      )}

      {/* Template list */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Saved Templates ({templates.length})</h3>
        <button
          onClick={() => showNew ? resetForm() : setShowNew(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700"
        >
          {showNew ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {showNew ? 'Cancel' : 'New Template'}
        </button>
      </div>

      {/* New / Edit form */}
      {showNew && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
          <h4 className="text-sm font-semibold text-gray-900">{editing ? 'Edit Template' : 'New Template'}</h4>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Template Name *</label>
              <input value={formName} onChange={e => setFormName(e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" placeholder="e.g., Deep Enrichment" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Type</label>
              <select value={formType} onChange={e => setFormType(e.target.value as any)} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white" disabled={!!editing}>
                <option value="enrichment">Enrichment Only</option>
                <option value="inbound">Inbound</option>
                <option value="outbound">Outbound</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 block mb-1">Enrichment Prompt Template</label>
            <p className="text-[10px] text-gray-400 mb-1">Custom instructions for the AI enrichment agent. Use {'{company_name}'}, {'{domain}'}, {'{segment}'} as placeholders.</p>
            <textarea
              value={formPrompt}
              onChange={e => setFormPrompt(e.target.value)}
              rows={6}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg font-mono"
              placeholder={`Research {company_name} ({domain}) and provide:\n1. Current VPN/remote access infrastructure\n2. Recent security incidents or initiatives\n3. Key decision makers for network security\n4. Technology stack signals`}
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 block mb-2">Output Fields</label>
            <div className="flex flex-wrap gap-2">
              {availableFields.map(f => (
                <button
                  key={f}
                  onClick={() => setFormFields(prev =>
                    prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]
                  )}
                  className={`px-2 py-1 text-xs rounded-full border transition-colors ${
                    formFields.includes(f)
                      ? 'bg-brand-50 border-brand-200 text-brand-700 font-medium'
                      : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  {f.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={handleSave} disabled={!formName || saving} className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Saving...' : editing ? 'Update Template' : 'Save Template'}
            </button>
            {editing && (
              <button onClick={resetForm} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
            )}
          </div>
        </div>
      )}

      {/* Template cards */}
      {templates.length === 0 && !showNew ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <Beaker className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">No enrichment templates yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {templates.map(t => (
            <div key={t.id} className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h4 className="text-sm font-medium text-gray-900">{t.name}</h4>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                    t.type === 'enrichment' ? 'bg-purple-50 text-purple-700' :
                    t.type === 'inbound' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'
                  }`}>{t.type}</span>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => startEdit(t)} className="p-1 text-gray-400 hover:text-brand-600"><Settings className="w-3.5 h-3.5" /></button>
                  <button onClick={() => handleDelete(t.id)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              {t.prompt_template && (
                <p className="text-xs text-gray-500 line-clamp-2 mb-2">{t.prompt_template}</p>
              )}
              <div className="flex flex-wrap gap-1">
                {(t.output_format?.fields || []).slice(0, 5).map((f: string) => (
                  <span key={f} className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">{f.replace(/_/g, ' ')}</span>
                ))}
                {(t.output_format?.fields || []).length > 5 && (
                  <span className="text-[10px] text-gray-400">+{(t.output_format?.fields || []).length - 5} more</span>
                )}
              </div>
              <p className="text-[10px] text-gray-400 mt-2">{new Date(t.created_at).toLocaleDateString()}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Shared Components ───────────────────────────────────────────

function SourceTypeBadge({ type }: { type: string }) {
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
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[type] || 'bg-gray-50 text-gray-600'}`}>
      {labels[type] || type}
    </span>
  );
}

function ImportStatusBadge({ status }: { status: string }) {
  const config: Record<string, { icon: typeof CheckCircle; color: string }> = {
    completed: { icon: CheckCircle, color: 'text-emerald-600' },
    processing: { icon: Loader2, color: 'text-amber-600' },
    pending: { icon: Clock, color: 'text-gray-400' },
    failed: { icon: XCircle, color: 'text-red-600' },
  };
  const { icon: Icon, color } = config[status] || config.pending;
  return (
    <span className={`flex items-center gap-1 text-xs ${color}`}>
      <Icon className={`w-3 h-3 ${status === 'processing' ? 'animate-spin' : ''}`} />
      {status}
    </span>
  );
}
