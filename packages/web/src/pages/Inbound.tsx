import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { formatDate } from '../utils/dates';
import { LeadCard } from '../components/LeadCard';
import {
  Webhook, CheckCircle, XCircle, Loader2,
  Clock, ArrowRight, RefreshCw, Copy,
} from 'lucide-react';

type Tab = 'webhook' | 'history';

interface Campaign {
  id: string;
  name: string;
  status: string;
}

export function Inbound() {
  const [tab, setTab] = useState<Tab>('webhook');
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

  const tabs: { key: Tab; label: string; icon: typeof Webhook }[] = [
    { key: 'webhook', label: 'Webhook', icon: Webhook },
    { key: 'history', label: 'Import History', icon: Clock },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Connect</h1>
        <p className="text-sm text-gray-500">
          Receive leads from external tools via webhook. For CSV uploads and domain lists, use{' '}
          <Link to="/research" className="text-brand-600 hover:text-brand-700 font-medium">Research</Link>.
        </p>
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

      {tab === 'webhook' && <WebhookTab />}

      {tab === 'history' && (
        <>
          {/* Selected import detail */}
          {selectedImport && (
            <div className="mb-8">
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

          {/* Import history table */}
          <div>
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
                <Webhook className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-500">No imports yet.</p>
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
                        <td className="px-4 py-3 text-gray-900">{imp.filename || '-'}</td>
                        <td className="px-4 py-3 text-gray-700">{imp.row_count}</td>
                        <td className="px-4 py-3 text-gray-700">{imp.processed_count}</td>
                        <td className="px-4 py-3"><span className="text-emerald-700 font-medium">{imp.qualified_count}</span></td>
                        <td className="px-4 py-3"><ImportStatusBadge status={imp.status} /></td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(imp.created_at)}</td>
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
        </>
      )}
    </div>
  );
}

// ── Webhook Tab ─────────────────────────────────────────────────

function WebhookTab() {
  const baseUrl = window.location.origin;
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [defaultCampaignId, setDefaultCampaignId] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api('/campaigns').then((data: any) => {
      const list = (Array.isArray(data) ? data : data.campaigns || [])
        .filter((c: Campaign) => c.status === 'active');
      setCampaigns(list);
    }).catch(() => {});

    api('/settings/webhook_default_campaign').then((data: any) => {
      if (data?.value) setDefaultCampaignId(data.value);
    }).catch(() => {});
  }, []);

  async function saveDefaultCampaign(id: string) {
    setDefaultCampaignId(id);
    setSaving(true);
    try {
      await api('/settings/webhook_default_campaign', {
        method: 'PUT',
        body: JSON.stringify({ value: id }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { }
    finally { setSaving(false); }
  }

  function copyEndpoint() {
    navigator.clipboard.writeText(`${baseUrl}/api/inbound/webhook`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Default campaign config */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Default Campaign</h3>
        <p className="text-sm text-gray-500 mb-4">
          Incoming webhook leads will be researched against this campaign's settings.
          You can also specify <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">campaign_id</code> per request to override.
        </p>
        <div className="flex items-center gap-3">
          <select
            value={defaultCampaignId}
            onChange={e => saveDefaultCampaign(e.target.value)}
            className="flex-1 max-w-md px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent appearance-none bg-white"
          >
            <option value="">Select default campaign...</option>
            {campaigns.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {saving && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
          {saved && <span className="text-xs text-emerald-600 font-medium">Saved</span>}
        </div>
      </div>

      {/* Endpoint & auth */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Inbound Webhook</h3>
        <p className="text-sm text-gray-500 mb-6">
          Send leads from external tools (Zapier, HubSpot, Salesforce, event platforms) directly into the research pipeline.
        </p>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-gray-500 uppercase font-medium block mb-1">Endpoint</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 block px-3 py-2 bg-gray-50 rounded-lg text-sm font-mono text-gray-700 select-all">
                POST {baseUrl}/api/inbound/webhook
              </code>
              <button
                onClick={copyEndpoint}
                className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
                title="Copy endpoint URL"
              >
                {copied ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
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
  -d '{
    "campaign_id": "OPTIONAL_CAMPAIGN_ID",
    "leads": [
      {
        "company_name": "Acme Corp",
        "domain": "acme.com",
        "segment": "ENT",
        "contact_name": "Jane Smith",
        "contact_email": "jane@acme.com"
      }
    ]
  }'`}
          </pre>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Supported Fields</h4>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div><code className="text-brand-600">campaign_id</code> — Override default campaign</div>
              <div><code className="text-brand-600">leads</code> <span className="text-red-500">*</span> — Array of lead objects</div>
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
