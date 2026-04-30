import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthContext } from '../App';
import { api } from '../api/client';
import {
  Building2,
  User,
  AppWindow,
  Shield,
  Users,
  Target,
  Pencil,
  Key,
  CheckCircle,
  Crown,
  Eye,
  Wrench,
  UserCog,
  Mail,
  Plus,
  Trash2,
  Copy,
  ShieldCheck,
  X,
  Globe,
  Database,
  Cloud,
  Zap,
  ExternalLink,
  Play,
  AlertCircle,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Save,
  Download,
  Upload,
  HardDrive,
  FileJson,
  Loader2,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────

interface SettingsProps {
  tab?: 'org' | 'profile' | 'app';
}

interface TeamUser {
  id: string;
  email: string;
  display_name: string;
  role: string;
  created_at: string;
}

interface Invite {
  id: string;
  email: string;
  role: string;
  token: string;
  expires_at: string;
  accepted_at: string | null;
}

interface DataSourceConfig {
  id: string;
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  requires_key: boolean;
  api_key?: string;
  status: string;
  settings: Record<string, any>;
}

interface ExclusionEntry {
  id: string;
  company_name: string;
  domain?: string;
  industry?: string;
  reason?: string;
}

const ROLE_META: Record<string, { icon: any; label: string; color: string; bg: string; description: string }> = {
  superadmin: { icon: ShieldCheck, label: 'Super Admin', color: 'text-purple-600', bg: 'bg-purple-50 border-purple-200', description: 'Ultimate authority — manages admins, system-wide settings' },
  admin: { icon: Crown, label: 'Admin', color: 'text-red-600', bg: 'bg-red-50 border-red-200', description: 'Full access — user management, system settings' },
  operator: { icon: Wrench, label: 'Operator', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', description: 'Configure ICP, prompts, data sources, campaigns' },
  member: { icon: UserCog, label: 'Member', color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200', description: 'Run campaigns, import leads, provide feedback' },
  viewer: { icon: Eye, label: 'Viewer', color: 'text-gray-600', bg: 'bg-gray-50 border-gray-200', description: 'Read-only access to leads and dashboards' },
};

function isAdminLevel(role?: string): boolean {
  return role === 'superadmin' || role === 'admin';
}

// ── Main Settings Component ────────────────────────────────────

const TABS = [
  { key: 'org', label: 'Org Settings', icon: Building2, adminOnly: true, path: '/settings/org' },
  { key: 'profile', label: 'Profile', icon: User, adminOnly: false, path: '/settings/profile' },
  { key: 'app', label: 'App Settings', icon: AppWindow, adminOnly: true, path: '/settings/app' },
] as const;

export function Settings({ tab: initialTab }: SettingsProps) {
  const { user } = useAuthContext();
  const navigate = useNavigate();
  const isAdmin = isAdminLevel(user?.role);

  const effectiveTab = (!isAdmin && initialTab !== 'profile') ? 'profile' : (initialTab || 'org');

  const visibleTabs = TABS.filter(t => !t.adminOnly || isAdmin);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your organization, profile, and app configuration</p>
      </div>

      <div className="flex border-b border-gray-200 mb-6">
        {visibleTabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => navigate(`/settings/${key}`)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
              effectiveTab === key
                ? 'border-brand-500 text-brand-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {effectiveTab === 'org' && isAdmin && <OrgSettingsTab />}
      {effectiveTab === 'profile' && <ProfileTab />}
      {effectiveTab === 'app' && isAdmin && <AppSettingsTab />}
    </div>
  );
}

// ── Org Settings Tab ───────────────────────────────────────────

function OrgSettingsTab() {
  const [section, setSection] = useState<'icp' | 'sources' | 'exclusions' | 'team'>('icp');

  const sections = [
    { key: 'icp', label: 'ICP Defaults', icon: Target },
    { key: 'sources', label: 'Data Sources', icon: Database },
    { key: 'exclusions', label: 'Global Exclusions', icon: Shield },
    { key: 'team', label: 'Team & Roles', icon: Users },
  ] as const;

  return (
    <div>
      <div className="flex gap-2 mb-6">
        {sections.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setSection(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
              section === key
                ? 'bg-brand-50 border-brand-200 text-brand-700 font-medium'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {section === 'icp' && <ICPDefaultsSection />}
      {section === 'sources' && <DataSourcesSection />}
      {section === 'exclusions' && <GlobalExclusionsSection />}
      {section === 'team' && <TeamSection />}
    </div>
  );
}

// ── ICP Defaults Section ───────────────────────────────────────

function ICPDefaultsSection() {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    api('/icp/full').then(data => { setConfig(data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await api('/icp', {
        method: 'PUT',
        body: JSON.stringify({
          segments: config.segments,
          verticals: config.verticals,
          tech_signals: config.tech_signals,
          competitors: config.competitors,
          success_stories: config.success_stories,
        }),
      });
      setMessage({ type: 'success', text: 'ICP defaults saved. Campaigns will inherit these unless they override.' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to save' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-gray-500 text-sm">Loading ICP configuration...</div>;
  if (!config) return <div className="text-red-500 text-sm">Failed to load ICP configuration</div>;

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
        <p className="text-sm text-blue-700">
          These are the <strong>global defaults</strong> inherited by all campaigns. Individual campaigns can override any setting.
        </p>
      </div>

      {message && (
        <div className={`px-4 py-3 rounded-lg text-sm ${
          message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
        }`}>{message.text}</div>
      )}

      {/* Segments */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Segment Definitions</h3>
        <div className="grid grid-cols-3 gap-4">
          {Object.entries(config.segments || {}).map(([seg, vals]: [string, any]) => (
            <div key={seg} className="border border-gray-200 rounded-lg p-4">
              <p className="text-sm font-bold text-gray-900 mb-3">{seg}</p>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-500">VPN Users Min</label>
                    <input type="number" value={vals.vpn_users_min || ''} onChange={e => setConfig({ ...config, segments: { ...config.segments, [seg]: { ...vals, vpn_users_min: parseInt(e.target.value) || 0 }}})} className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">VPN Users Max</label>
                    <input type="number" value={vals.vpn_users_max || ''} onChange={e => setConfig({ ...config, segments: { ...config.segments, [seg]: { ...vals, vpn_users_max: parseInt(e.target.value) || 0 }}})} className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Verticals & Tech Signals */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Target Verticals</h3>
        <div className="flex flex-wrap gap-2">
          {(config.verticals || []).map((v: string, i: number) => (
            <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 bg-brand-50 text-brand-700 rounded-full text-xs font-medium">
              {v}
              <button onClick={() => setConfig({ ...config, verticals: config.verticals.filter((_: any, j: number) => j !== i) })} className="hover:text-red-500"><X className="w-3 h-3" /></button>
            </span>
          ))}
          <input
            type="text"
            placeholder="Add vertical..."
            className="px-2.5 py-1 text-xs border border-dashed border-gray-300 rounded-full w-32"
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                setConfig({ ...config, verticals: [...(config.verticals || []), (e.target as HTMLInputElement).value.trim()] });
                (e.target as HTMLInputElement).value = '';
              }
            }}
          />
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Tech Signals to Detect</h3>
        <div className="flex flex-wrap gap-2">
          {(config.tech_signals || []).map((s: string, i: number) => (
            <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-full text-xs font-medium">
              {s}
              <button onClick={() => setConfig({ ...config, tech_signals: config.tech_signals.filter((_: any, j: number) => j !== i) })} className="hover:text-red-500"><X className="w-3 h-3" /></button>
            </span>
          ))}
          <input
            type="text"
            placeholder="Add signal..."
            className="px-2.5 py-1 text-xs border border-dashed border-gray-300 rounded-full w-36"
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                setConfig({ ...config, tech_signals: [...(config.tech_signals || []), (e.target as HTMLInputElement).value.trim()] });
                (e.target as HTMLInputElement).value = '';
              }
            }}
          />
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Competitors to Displace</h3>
        <div className="flex flex-wrap gap-2">
          {(config.competitors || []).map((c: string, i: number) => (
            <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-50 text-red-700 rounded-full text-xs font-medium">
              {c}
              <button onClick={() => setConfig({ ...config, competitors: config.competitors.filter((_: any, j: number) => j !== i) })} className="hover:text-red-900"><X className="w-3 h-3" /></button>
            </span>
          ))}
          <input
            type="text"
            placeholder="Add competitor..."
            className="px-2.5 py-1 text-xs border border-dashed border-gray-300 rounded-full w-36"
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                setConfig({ ...config, competitors: [...(config.competitors || []), (e.target as HTMLInputElement).value.trim()] });
                (e.target as HTMLInputElement).value = '';
              }
            }}
          />
        </div>
      </div>

      <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-5 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50">
        <Save className="w-4 h-4" />
        {saving ? 'Saving...' : 'Save ICP Defaults'}
      </button>
    </div>
  );
}

// ── Data Sources Section ───────────────────────────────────────

function DataSourcesSection() {
  const [sources, setSources] = useState<DataSourceConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    api('/data-sources').then(data => { setSources(data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const toggleSource = async (id: string, enabled: boolean) => {
    try {
      await api(`/data-sources/${id}`, { method: 'PUT', body: JSON.stringify({ enabled }) });
      setSources(sources.map(s => s.id === id ? { ...s, enabled } : s));
    } catch (err: any) {
      alert(err.message || 'Failed to update');
    }
  };

  const testSource = async (id: string) => {
    try {
      const result = await api(`/data-sources/${id}/test`, { method: 'POST' });
      alert((result as any).ok ? 'Connection successful!' : `Failed: ${(result as any).message}`);
    } catch (err: any) {
      alert(err.message || 'Test failed');
    }
  };

  if (loading) return <div className="text-gray-500 text-sm">Loading data sources...</div>;

  const freeSources = sources.filter(s => !s.requires_key);
  const paidSources = sources.filter(s => s.requires_key);

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
        <p className="text-sm text-blue-700">
          These are the <strong>global default</strong> data source settings. Campaigns can enable/disable individual sources.
        </p>
      </div>

      {[
        { label: 'Built-in Sources (Free)', items: freeSources },
        { label: 'API-Connected Sources', items: paidSources },
      ].map(group => (
        <div key={group.label}>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">{group.label}</h3>
          <div className="space-y-2">
            {group.items.map(source => (
              <div key={source.id} className="bg-white border border-gray-200 rounded-lg">
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <button
                      onClick={() => setExpanded(expanded === source.id ? null : source.id)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      {expanded === source.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{source.name}</p>
                      <p className="text-xs text-gray-500 truncate">{source.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${source.status === 'active' ? 'bg-green-50 text-green-700' : source.status === 'error' ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
                      {source.status}
                    </span>
                    <button
                      onClick={() => toggleSource(source.id, !source.enabled)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${source.enabled ? 'bg-brand-600' : 'bg-gray-300'}`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${source.enabled ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                </div>
                {expanded === source.id && (
                  <div className="px-4 pb-4 border-t border-gray-100 pt-3">
                    <div className="flex gap-2">
                      <button onClick={() => testSource(source.id)} className="flex items-center gap-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">
                        <Play className="w-3 h-3" /> Test Connection
                      </button>
                    </div>
                    {source.requires_key && (
                      <div className="mt-3">
                        <label className="text-xs text-gray-500 block mb-1">API Key</label>
                        <input
                          type="password"
                          placeholder={source.api_key ? '••••••••' : 'Enter API key'}
                          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg"
                          onBlur={async (e) => {
                            if (e.target.value) {
                              await api(`/data-sources/${source.id}`, { method: 'PUT', body: JSON.stringify({ api_key: e.target.value }) });
                            }
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Global Exclusions Section ──────────────────────────────────

function GlobalExclusionsSection() {
  const [exclusions, setExclusions] = useState<ExclusionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDomain, setNewDomain] = useState('');
  const [newReason, setNewReason] = useState('');

  const loadExclusions = async () => {
    try {
      const data = await api('/exclusions');
      setExclusions(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadExclusions(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api('/exclusions', { method: 'POST', body: JSON.stringify({ company_name: newName, domain: newDomain, reason: newReason }) });
      setNewName(''); setNewDomain(''); setNewReason(''); setShowAdd(false);
      loadExclusions();
    } catch (err: any) {
      alert(err.message || 'Failed to add exclusion');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api(`/exclusions/${id}`, { method: 'DELETE' });
      loadExclusions();
    } catch (err: any) {
      alert(err.message || 'Failed to delete');
    }
  };

  if (loading) return <div className="text-gray-500 text-sm">Loading exclusions...</div>;

  const filtered = exclusions.filter(e =>
    e.company_name.toLowerCase().includes(search.toLowerCase()) ||
    (e.domain || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
        <p className="text-sm text-blue-700">
          Global exclusions are inherited by <strong>all campaigns</strong>. Campaigns can add their own exclusions or exempt specific globals.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <input type="text" placeholder="Search exclusions..." value={search} onChange={e => setSearch(e.target.value)} className="px-3 py-2 text-sm border border-gray-300 rounded-lg w-64" />
        <div className="flex gap-2">
          <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700">
            {showAdd ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            {showAdd ? 'Cancel' : 'Add'}
          </button>
        </div>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="bg-white border border-gray-200 rounded-lg p-4 flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-xs text-gray-500 block mb-1">Company Name *</label>
            <input type="text" value={newName} onChange={e => setNewName(e.target.value)} required className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
          </div>
          <div className="w-48">
            <label className="text-xs text-gray-500 block mb-1">Domain</label>
            <input type="text" value={newDomain} onChange={e => setNewDomain(e.target.value)} placeholder="example.com" className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
          </div>
          <div className="flex-1">
            <label className="text-xs text-gray-500 block mb-1">Reason</label>
            <input type="text" value={newReason} onChange={e => setNewReason(e.target.value)} placeholder="Existing customer, competitor, etc." className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
          </div>
          <button type="submit" className="px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700">Add</button>
        </form>
      )}

      <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
        {filtered.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-gray-500">
            {search ? 'No exclusions match your search' : 'No global exclusions yet'}
          </div>
        ) : (
          filtered.map(exc => (
            <div key={exc.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-gray-900">{exc.company_name}</p>
                <p className="text-xs text-gray-500">{exc.domain}{exc.reason ? ` — ${exc.reason}` : ''}</p>
              </div>
              <button onClick={() => handleDelete(exc.id)} className="p-1 text-gray-300 hover:text-red-500">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))
        )}
      </div>

      <p className="text-xs text-gray-400">{exclusions.length} total exclusion{exclusions.length !== 1 ? 's' : ''}</p>
    </div>
  );
}

// ── Team Section ───────────────────────────────────────────────
// (Extracted from Profile.tsx TeamTab — full team & role management)

function TeamSection() {
  const { user } = useAuthContext();
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviting, setInviting] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [selfRegEnabled, setSelfRegEnabled] = useState(false);
  const [savingSelfReg, setSavingSelfReg] = useState(false);

  const isSuperAdmin = user?.role === 'superadmin';

  const loadData = async () => {
    try {
      const [usersData, invitesData, regSettings] = await Promise.all([
        api('/users'),
        api('/users/invites'),
        api('/users/settings/registration').catch(() => ({ allow_self_registration: false })),
      ]);
      setUsers(usersData);
      setInvites(invitesData);
      setSelfRegEnabled((regSettings as any).allow_self_registration);
    } catch (err) {
      console.error('Failed to load team data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      await api(`/users/${userId}/role`, { method: 'PATCH', body: JSON.stringify({ role: newRole }) });
      loadData();
    } catch (err: any) { alert(err.message || 'Failed to change role'); }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    setInviteMessage(null);
    try {
      const result = await api('/users/invites', { method: 'POST', body: JSON.stringify({ email: inviteEmail, role: inviteRole }) }) as any;
      setInviteMessage({ type: 'success', text: `Invite sent! Share this link: ${window.location.origin}/register?invite=${result.token}` });
      setInviteEmail(''); setInviteRole('member');
      loadData();
    } catch (err: any) {
      setInviteMessage({ type: 'error', text: err.message || 'Failed to create invite' });
    } finally { setInviting(false); }
  };

  const handleRevokeInvite = async (id: string) => {
    try { await api(`/users/invites/${id}`, { method: 'DELETE' }); loadData(); }
    catch (err: any) { alert(err.message || 'Failed to revoke invite'); }
  };

  const handleRemoveUser = async (userId: string, name: string) => {
    if (!confirm(`Remove ${name} from the team? This cannot be undone.`)) return;
    try { await api(`/users/${userId}`, { method: 'DELETE' }); loadData(); }
    catch (err: any) { alert(err.message || 'Failed to remove user'); }
  };

  const copyInviteLink = (token: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/register?invite=${token}`);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const toggleSelfRegistration = async () => {
    setSavingSelfReg(true);
    try {
      await api('/users/settings/registration', { method: 'PUT', body: JSON.stringify({ allow_self_registration: !selfRegEnabled }) });
      setSelfRegEnabled(!selfRegEnabled);
    } catch (err: any) { alert(err.message || 'Failed to update setting'); }
    finally { setSavingSelfReg(false); }
  };

  const getAssignableRoles = () => isSuperAdmin ? ['admin', 'operator', 'member', 'viewer'] : ['operator', 'member', 'viewer'];
  const canModifyUser = (targetRole: string) => isSuperAdmin ? true : targetRole !== 'superadmin' && targetRole !== 'admin';

  if (loading) return <div className="text-gray-500 text-sm">Loading team...</div>;

  const pendingInvites = invites.filter(i => !i.accepted_at && new Date(i.expires_at) > new Date());

  return (
    <div className="space-y-6">
      {/* Role reference */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Role Permissions</h3>
        <div className="grid grid-cols-2 gap-3">
          {Object.entries(ROLE_META).map(([role, meta]) => {
            const Icon = meta.icon;
            return (
              <div key={role} className={`border rounded-lg p-3 ${meta.bg}`}>
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={`w-4 h-4 ${meta.color}`} />
                  <span className={`text-sm font-medium ${meta.color}`}>{meta.label}</span>
                </div>
                <p className="text-xs text-gray-600">{meta.description}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Self-registration toggle (superadmin only) */}
      {isSuperAdmin && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Allow Self-Registration</p>
              <p className="text-xs text-gray-500 mt-0.5">When disabled, only invited users can join.</p>
            </div>
            <button onClick={toggleSelfRegistration} disabled={savingSelfReg}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${selfRegEnabled ? 'bg-brand-600' : 'bg-gray-300'}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${selfRegEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
        </div>
      )}

      {/* Invite form */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-medium text-gray-900">Invite Team Members</h3>
          <button onClick={() => setShowInviteForm(!showInviteForm)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700">
            {showInviteForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            {showInviteForm ? 'Cancel' : 'New Invite'}
          </button>
        </div>
        {showInviteForm && (
          <form onSubmit={handleInvite} className="px-6 py-4 border-b border-gray-100 bg-gray-50">
            {inviteMessage && (
              <div className={`mb-3 px-4 py-3 rounded-lg text-sm ${inviteMessage.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                {inviteMessage.text}
              </div>
            )}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="colleague@company.com" required className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
              </div>
              <div className="w-40">
                <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
                <select value={inviteRole} onChange={e => setInviteRole(e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white">
                  {getAssignableRoles().map(r => <option key={r} value={r}>{ROLE_META[r]?.label || r}</option>)}
                </select>
              </div>
              <div className="flex items-end">
                <button type="submit" disabled={inviting} className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50">
                  <Mail className="w-3.5 h-3.5" />{inviting ? 'Sending...' : 'Send Invite'}
                </button>
              </div>
            </div>
          </form>
        )}
        {pendingInvites.length > 0 && (
          <div className="px-6 py-3 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Pending Invites ({pendingInvites.length})</p>
            {pendingInvites.map(invite => {
              const meta = ROLE_META[invite.role] || ROLE_META.viewer;
              return (
                <div key={invite.id} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-3">
                    <Mail className="w-3.5 h-3.5 text-yellow-500" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">{invite.email}</p>
                      <p className="text-xs text-gray-500">As <span className={meta.color}>{meta.label}</span> · Expires {new Date(invite.expires_at).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => copyInviteLink(invite.token)} className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 border border-gray-200 rounded hover:text-gray-900">
                      {copiedToken === invite.token ? <><CheckCircle className="w-3 h-3 text-green-500" /> Copied</> : <><Copy className="w-3 h-3" /> Copy Link</>}
                    </button>
                    <button onClick={() => handleRevokeInvite(invite.id)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* User list */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-medium text-gray-900">Team Members ({users.length})</h3>
        </div>
        <div className="divide-y divide-gray-100">
          {users.map(u => {
            const meta = ROLE_META[u.role] || ROLE_META.member;
            const isCurrentUser = u.id === user?.id;
            const canModify = !isCurrentUser && canModifyUser(u.role);
            return (
              <div key={u.id} className="flex items-center justify-between px-6 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                    <span className="text-xs font-medium text-gray-500">{u.display_name.charAt(0).toUpperCase()}</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{u.display_name}{isCurrentUser && <span className="text-xs text-gray-400 ml-1">(you)</span>}</p>
                    <p className="text-xs text-gray-500">{u.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isCurrentUser || !canModify ? (
                    <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${meta.bg} ${meta.color}`}>{meta.label}</span>
                  ) : (
                    <select value={u.role} onChange={e => handleRoleChange(u.id, e.target.value)} className={`text-xs px-2.5 py-1 rounded-lg border font-medium cursor-pointer ${meta.bg} ${meta.color}`}>
                      {isSuperAdmin && <option value="superadmin">Super Admin</option>}
                      {getAssignableRoles().map(r => <option key={r} value={r}>{ROLE_META[r]?.label || r}</option>)}
                    </select>
                  )}
                  <span className="text-xs text-gray-400">Joined {new Date(u.created_at).toLocaleDateString()}</span>
                  {canModify && (
                    <button onClick={() => handleRemoveUser(u.id, u.display_name)} className="p-1 text-gray-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Profile Tab ────────────────────────────────────────────────

function ProfileTab() {
  const { user } = useAuthContext();
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const roleMeta = ROLE_META[user?.role] || ROLE_META.member;
  const RoleIcon = roleMeta.icon;

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const body: any = {};
      if (displayName !== user?.display_name) body.display_name = displayName;
      if (newPassword) {
        if (newPassword !== confirmPassword) { setMessage({ type: 'error', text: 'Passwords do not match' }); setSaving(false); return; }
        body.current_password = currentPassword;
        body.new_password = newPassword;
      }
      if (Object.keys(body).length === 0) { setMessage({ type: 'error', text: 'No changes to save' }); setSaving(false); return; }
      await api('/users/profile', { method: 'PUT', body: JSON.stringify(body) });
      setMessage({ type: 'success', text: 'Profile updated successfully' });
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      window.location.reload();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to update profile' });
    } finally { setSaving(false); }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className={`border rounded-lg p-4 flex items-center gap-4 ${roleMeta.bg}`}>
        <div className={`p-2 rounded-lg bg-white/60 ${roleMeta.color}`}><RoleIcon className="w-5 h-5" /></div>
        <div>
          <p className="font-medium text-gray-900">Your role: <span className={roleMeta.color}>{roleMeta.label}</span></p>
          <p className="text-sm text-gray-600">{roleMeta.description}</p>
        </div>
      </div>

      {message && (
        <div className={`px-4 py-3 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{message.text}</div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2"><Pencil className="w-4 h-4" /> Profile Information</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input type="email" value={user?.email || ''} disabled className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
            <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2"><Key className="w-4 h-4" /> Change Password</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
            <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Enter current password" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Min 6 characters" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
              <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Re-enter new password" />
            </div>
          </div>
        </div>
      </div>

      <button onClick={handleSave} disabled={saving} className="px-6 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50">
        {saving ? 'Saving...' : 'Save Changes'}
      </button>
    </div>
  );
}

// ── App Settings Tab ───────────────────────────────────────────

function AppSettingsTab() {
  const [pipelineConfig, setPipelineConfig] = useState<any>(null);
  const [promptConfig, setPromptConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    Promise.all([
      api('/icp/pipeline'),
      api('/icp/prompts'),
    ]).then(([pipeline, prompts]) => {
      setPipelineConfig(pipeline);
      setPromptConfig(prompts);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleSavePipeline = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await api('/icp/pipeline', { method: 'PUT', body: JSON.stringify(pipelineConfig) });
      setMessage({ type: 'success', text: 'Pipeline configuration saved' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to save' });
    } finally { setSaving(false); }
  };

  if (loading) return <div className="text-gray-500 text-sm">Loading app settings...</div>;

  return (
    <div className="space-y-6">
      {message && (
        <div className={`px-4 py-3 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{message.text}</div>
      )}

      {/* App Info */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2"><Zap className="w-4 h-4 text-brand-500" /> SignalStack</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Version</p>
            <p className="font-medium text-gray-900">1.0.0</p>
          </div>
          <div>
            <p className="text-gray-500">AI Provider</p>
            <p className="font-medium text-gray-900">Claude via Google Vertex AI</p>
          </div>
          <div>
            <p className="text-gray-500">Database</p>
            <p className="font-medium text-gray-900">SQLite (local)</p>
          </div>
          <div>
            <p className="text-gray-500">Environment</p>
            <p className="font-medium text-gray-900">development</p>
          </div>
        </div>
      </div>

      {/* Vertex AI Configuration */}
      <VertexAISettings />

      {/* API Keys */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2"><Key className="w-4 h-4 text-amber-500" /> API Keys</h3>
        <p className="text-xs text-gray-500 mb-4">Manage API keys for external services. Keys are stored securely and never displayed in full.</p>
        <ApiKeysManager />
      </div>

      {/* Connection Testing */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2"><RefreshCw className="w-4 h-4 text-emerald-500" /> Connection Testing</h3>
        <p className="text-xs text-gray-500 mb-4">Test connections to verify your configuration is working.</p>
        <ConnectionTester />
      </div>

      {/* Claude Agent Configuration */}
      {pipelineConfig && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Pipeline Defaults</h3>
          <p className="text-xs text-gray-500 mb-4">Default settings used when campaigns don't specify their own. Each campaign's Pipeline tab can override these.</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Default Model</label>
              <select value={pipelineConfig.model} onChange={e => setPipelineConfig({ ...pipelineConfig, model: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-200 rounded">
                <option value="claude-sonnet-4-6@default">Claude Sonnet 4.6 (fast, cost-effective)</option>
                <option value="claude-opus-4-6@default">Claude Opus 4.6 (highest quality)</option>
                <option value="claude-haiku-4-5@20251001">Claude Haiku 4.5 (fastest, lowest cost)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Max Tokens (Research)</label>
              <input type="number" value={pipelineConfig.max_tokens_research} onChange={e => setPipelineConfig({ ...pipelineConfig, max_tokens_research: parseInt(e.target.value) })} className="w-full px-3 py-2 text-sm border border-gray-200 rounded" />
            </div>
          </div>
          <button onClick={handleSavePipeline} disabled={saving} className="mt-4 flex items-center gap-2 px-5 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50">
            <Save className="w-4 h-4" />{saving ? 'Saving...' : 'Save Pipeline Defaults'}
          </button>
        </div>
      )}

      {/* Outreach Tone */}
      {promptConfig && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Outreach & Prompt Defaults</h3>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Outreach Tone</label>
              <select value={promptConfig.outreach_tone} onChange={e => setPromptConfig({ ...promptConfig, outreach_tone: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-200 rounded">
                <option value="consultative">Consultative</option>
                <option value="direct">Direct</option>
                <option value="technical">Technical</option>
                <option value="executive">Executive</option>
                <option value="casual">Casual</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Research Preamble</label>
              <textarea value={promptConfig.research_preamble || ''} onChange={e => setPromptConfig({ ...promptConfig, research_preamble: e.target.value })} rows={3} className="w-full px-3 py-2 text-sm border border-gray-200 rounded" placeholder="Additional context for the AI research agent..." />
            </div>
          </div>
          <button onClick={async () => {
            try {
              await api('/icp/prompts', { method: 'PUT', body: JSON.stringify(promptConfig) });
              setMessage({ type: 'success', text: 'Prompt configuration saved' });
            } catch (err: any) { setMessage({ type: 'error', text: err.message || 'Failed to save' }); }
          }} className="mt-4 flex items-center gap-2 px-5 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700">
            <Save className="w-4 h-4" /> Save Prompt Config
          </button>
        </div>
      )}

      {/* Backup & Restore */}
      <BackupRestoreSection />

      {/* API Reference */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2"><ExternalLink className="w-4 h-4 text-gray-400" /> API Reference</h3>
        <div className="space-y-2 text-sm">
          {[
            { method: 'GET', path: '/api/leads', desc: 'List leads with filters' },
            { method: 'GET', path: '/api/leads/:id', desc: 'Get lead detail' },
            { method: 'GET', path: '/api/campaigns', desc: 'List campaigns' },
            { method: 'POST', path: '/api/campaigns/:id/run', desc: 'Trigger campaign run' },
            { method: 'GET', path: '/api/runs', desc: 'List pipeline runs' },
            { method: 'POST', path: '/api/inbound/webhook', desc: 'Inbound lead webhook' },
            { method: 'GET', path: '/api/events/stream', desc: 'SSE real-time events' },
            { method: 'GET', path: '/api/exports/csv/detailed', desc: 'Export leads as CSV' },
          ].map(ep => (
            <div key={ep.path} className="flex items-center gap-3 py-1.5 border-b border-gray-50">
              <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${ep.method === 'GET' ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'}`}>{ep.method}</span>
              <code className="text-xs text-gray-700 font-mono">{ep.path}</code>
              <span className="text-xs text-gray-400 ml-auto">{ep.desc}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-3">Full OpenAPI spec available at <code className="text-xs">/api/docs/openapi.json</code></p>
      </div>
    </div>
  );
}

// ── Vertex AI Configuration ───────────────────────────────────

const VERTEX_REGIONS = [
  { value: 'us-east5', label: 'us-east5 (Ohio)' },
  { value: 'us-central1', label: 'us-central1 (Iowa)' },
  { value: 'europe-west1', label: 'europe-west1 (Belgium)' },
  { value: 'europe-west4', label: 'europe-west4 (Netherlands)' },
  { value: 'asia-southeast1', label: 'asia-southeast1 (Singapore)' },
];

const VERTEX_MODELS = [
  { value: 'claude-sonnet-4-6@default', label: 'Claude Sonnet 4.6 (fast, cost-effective)' },
  { value: 'claude-opus-4-6@default', label: 'Claude Opus 4.6 (highest quality)' },
  { value: 'claude-haiku-4-5@20251001', label: 'Claude Haiku 4.5 (fastest, cheapest)' },
];

interface VertexFieldConfig {
  value: string;
  source: 'database' | 'env' | 'default';
  env_present: boolean;
}

function VertexAISettings() {
  const [fields, setFields] = useState<Record<string, VertexFieldConfig>>({});
  const [form, setForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; latency_ms?: number } | null>(null);
  const [testing, setTesting] = useState(false);

  const loadConfig = async () => {
    try {
      const data = await api('/settings/vertex');
      setFields(data);
      setForm({
        project_id: data.project_id?.value || '',
        region: data.region?.value || 'us-east5',
        default_model: data.default_model?.value || 'claude-sonnet-4-6@default',
      });
    } catch {
      // Endpoint may not exist yet
    } finally { setLoading(false); }
  };

  useEffect(() => { loadConfig(); }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await api('/settings/vertex', { method: 'PUT', body: JSON.stringify(form) });
      setMessage({ type: 'success', text: 'Vertex AI configuration saved' });
      await loadConfig();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to save' });
    } finally { setSaving(false); }
  };

  const handleClear = async (field: string) => {
    setClearing(field);
    setMessage(null);
    try {
      await api(`/settings/vertex/${field}`, { method: 'DELETE' });
      setMessage({ type: 'success', text: `${field} cleared — using ${fields[field]?.env_present ? '.env' : 'default'} value` });
      await loadConfig();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to clear' });
    } finally { setClearing(null); }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api('/health/vertex');
      setTestResult(result.ok
        ? { ok: true, message: `Connected (${result.latency_ms}ms) — ${result.model} in ${result.region}`, latency_ms: result.latency_ms }
        : { ok: false, message: result.error || 'Connection failed' }
      );
    } catch (err: any) {
      setTestResult({ ok: false, message: err.message || 'Connection failed' });
    } finally { setTesting(false); }
  };

  if (loading) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <h3 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-2">
        <Cloud className="w-4 h-4 text-blue-500" /> Vertex AI Configuration
      </h3>
      <p className="text-xs text-gray-500 mb-4">Configure Claude API access via Google Cloud Vertex AI. Override .env values or clear to fall back.</p>

      {message && (
        <div className={`px-3 py-2 rounded-lg text-xs mb-4 ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{message.text}</div>
      )}

      <div className="space-y-4">
        {/* Project ID */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className="text-xs font-medium text-gray-700">Project ID</label>
            <SourceBadge source={fields.project_id?.source} />
            {fields.project_id?.source === 'database' && (
              <button onClick={() => handleClear('project_id')} disabled={clearing === 'project_id'} className="text-[10px] text-gray-400 hover:text-red-500 flex items-center gap-0.5">
                <X className="w-3 h-3" /> Clear
              </button>
            )}
          </div>
          <input
            type="text"
            value={form.project_id || ''}
            onChange={e => setForm({ ...form, project_id: e.target.value })}
            placeholder="your-gcp-project-id"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded"
          />
        </div>

        {/* Region */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className="text-xs font-medium text-gray-700">Region</label>
            <SourceBadge source={fields.region?.source} />
            {fields.region?.source === 'database' && (
              <button onClick={() => handleClear('region')} disabled={clearing === 'region'} className="text-[10px] text-gray-400 hover:text-red-500 flex items-center gap-0.5">
                <X className="w-3 h-3" /> Clear
              </button>
            )}
          </div>
          <select
            value={form.region || 'us-east5'}
            onChange={e => setForm({ ...form, region: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded bg-white"
          >
            {VERTEX_REGIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>

        {/* Default Model */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className="text-xs font-medium text-gray-700">Default Model</label>
            <SourceBadge source={fields.default_model?.source} />
            {fields.default_model?.source === 'database' && (
              <button onClick={() => handleClear('default_model')} disabled={clearing === 'default_model'} className="text-[10px] text-gray-400 hover:text-red-500 flex items-center gap-0.5">
                <X className="w-3 h-3" /> Clear
              </button>
            )}
          </div>
          <select
            value={form.default_model || 'claude-sonnet-4-6@default'}
            onChange={e => setForm({ ...form, default_model: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded bg-white"
          >
            {VERTEX_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-5">
        <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-5 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50">
          <Save className="w-4 h-4" />{saving ? 'Saving...' : 'Save'}
        </button>
        <button onClick={handleTest} disabled={testing} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
          <Play className="w-3.5 h-3.5" />{testing ? 'Testing...' : 'Test Connection'}
        </button>
      </div>

      {testResult && (
        <div className={`mt-3 px-3 py-2 rounded-lg text-xs flex items-center gap-2 ${testResult.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {testResult.ok ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
          {testResult.message}
        </div>
      )}
    </div>
  );
}

function SourceBadge({ source }: { source?: string }) {
  if (!source) return null;
  const styles: Record<string, string> = {
    database: 'bg-blue-50 text-blue-700 border-blue-200',
    env: 'bg-gray-100 text-gray-600 border-gray-200',
    default: 'bg-gray-50 text-gray-400 border-gray-100',
  };
  const labels: Record<string, string> = {
    database: 'override',
    env: '.env',
    default: 'default',
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${styles[source] || styles.default}`}>
      {labels[source] || source}
    </span>
  );
}

// ── API Keys Manager ──────────────────────────────────────────

const API_KEY_DEFS = [
  { id: 'webhook_signing_secret', label: 'Webhook Signing Secret', description: 'Secret for verifying inbound webhook signatures', sensitive: true },
];

function ApiKeysManager() {
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    api('/settings/keys')
      .then(data => { setKeys(data || {}); setLoading(false); })
      .catch(() => {
        // Endpoint may not exist yet — degrade gracefully
        setLoading(false);
      });
  }, []);

  const handleSaveKey = async (id: string, value: string) => {
    setSaving(id);
    setMessage(null);
    try {
      await api('/settings/keys', { method: 'PUT', body: JSON.stringify({ key: id, value }) });
      setKeys(prev => ({ ...prev, [id]: value }));
      setMessage({ type: 'success', text: `${id} saved` });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to save' });
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <p className="text-sm text-gray-400">Loading API keys...</p>;

  return (
    <div className="space-y-3">
      {message && (
        <div className={`px-3 py-2 rounded-lg text-xs ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{message.text}</div>
      )}
      {API_KEY_DEFS.map(def => (
        <div key={def.id} className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <label className="text-xs font-medium text-gray-700 block mb-0.5">{def.label}</label>
            <p className="text-[10px] text-gray-400">{def.description}</p>
            <input
              type={def.sensitive ? 'password' : 'text'}
              defaultValue={keys[def.id] || ''}
              placeholder={def.sensitive ? '••••••••' : 'Not set'}
              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg mt-1"
              onBlur={e => {
                if (e.target.value && e.target.value !== keys[def.id]) {
                  handleSaveKey(def.id, e.target.value);
                }
              }}
            />
          </div>
          {saving === def.id && <Loader className="w-4 h-4 text-brand-500 animate-spin mt-5" />}
        </div>
      ))}
    </div>
  );
}

// ── Connection Tester ─────────────────────────────────────────

function Loader({ className }: { className?: string }) {
  return <RefreshCw className={className} />;
}

const CONNECTION_TESTS = [
  { id: 'vertex_ai', label: 'Vertex AI (Claude)', endpoint: '/health/vertex' },
  { id: 'database', label: 'Database', endpoint: '/health/db' },
  { id: 'data_sources', label: 'Data Sources', endpoint: '/data-sources/health' },
];

function ConnectionTester() {
  const [results, setResults] = useState<Record<string, { status: 'pending' | 'success' | 'error'; message: string }>>({});
  const [testing, setTesting] = useState(false);

  const runTests = async () => {
    setTesting(true);
    const newResults: typeof results = {};

    for (const test of CONNECTION_TESTS) {
      newResults[test.id] = { status: 'pending', message: 'Testing...' };
      setResults({ ...newResults });

      try {
        const result = await api(test.endpoint, { method: 'GET' }).catch(() => null);
        newResults[test.id] = result
          ? { status: 'success', message: 'Connected' }
          : { status: 'error', message: 'Unreachable' };
      } catch {
        newResults[test.id] = { status: 'error', message: 'Failed' };
      }
      setResults({ ...newResults });
    }

    setTesting(false);
  };

  return (
    <div className="space-y-3">
      <button
        onClick={runTests}
        disabled={testing}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
      >
        <Play className="w-3.5 h-3.5" />
        {testing ? 'Testing...' : 'Run All Tests'}
      </button>

      {Object.keys(results).length > 0 && (
        <div className="space-y-2">
          {CONNECTION_TESTS.map(test => {
            const r = results[test.id];
            if (!r) return null;
            return (
              <div key={test.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                <span className="text-sm text-gray-700">{test.label}</span>
                <span className={`flex items-center gap-1 text-xs font-medium ${
                  r.status === 'success' ? 'text-emerald-600' : r.status === 'error' ? 'text-red-600' : 'text-amber-600'
                }`}>
                  {r.status === 'success' ? <CheckCircle className="w-3.5 h-3.5" /> :
                   r.status === 'error' ? <AlertCircle className="w-3.5 h-3.5" /> :
                   <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  {r.message}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Backup & Restore ─────────────────────────────────────────

function BackupRestoreSection() {
  const [exporting, setExporting] = useState<'config' | 'full' | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [preview, setPreview] = useState<any>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [importResult, setImportResult] = useState<any>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);

  const handleExport = async (mode: 'config' | 'full') => {
    setExporting(mode);
    setMessage(null);
    try {
      const token = localStorage.getItem('pg_token');
      const res = await fetch(`/api/config-transfer/export?mode=${mode}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Export failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `signalstack-${mode}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage({ type: 'success', text: `${mode === 'config' ? 'Config' : 'Full'} export downloaded` });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Export failed' });
    } finally {
      setExporting(null);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setImportResult(null);
    setMessage(null);
    setConfirmReplace(false);

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.metadata) {
        setMessage({ type: 'error', text: 'Invalid file — not a SignalStack export' });
        setSelectedFile(null);
        return;
      }

      const counts: Record<string, number> = {};
      for (const [key, value] of Object.entries(data)) {
        if (key !== 'metadata' && Array.isArray(value)) {
          counts[key] = value.length;
        }
      }
      setPreview({
        export_mode: data.metadata.export_mode,
        exported_at: data.metadata.exported_at,
        app_version: data.metadata.app_version,
        table_counts: counts,
      });
    } catch {
      setMessage({ type: 'error', text: 'Invalid JSON file' });
      setSelectedFile(null);
    }
  };

  const handleImport = async () => {
    if (!selectedFile) return;
    if (importMode === 'replace' && !confirmReplace) {
      setConfirmReplace(true);
      return;
    }

    setImporting(true);
    setMessage(null);
    setImportResult(null);

    try {
      const text = await selectedFile.text();
      const data = JSON.parse(text);
      const token = localStorage.getItem('pg_token');
      const res = await fetch(`/api/config-transfer/import?mode=${importMode}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Import failed');
      }

      const result = await res.json();
      setImportResult(result);
      setMessage({ type: 'success', text: `Import complete — ${result.tables_processed.length} tables processed` });
      setConfirmReplace(false);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Import failed' });
    } finally {
      setImporting(false);
    }
  };

  const totalRows = preview ? Object.values(preview.table_counts as Record<string, number>).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <h3 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-2">
        <HardDrive className="w-4 h-4 text-indigo-500" /> Backup & Restore
      </h3>
      <p className="text-xs text-gray-500 mb-5">Export your configuration and data for backup, migration, or deploying to a new instance.</p>

      {message && (
        <div className={`px-3 py-2 rounded-lg text-xs mb-4 flex items-start gap-2 ${
          message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' :
          message.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' :
          'bg-blue-50 text-blue-700 border border-blue-200'
        }`}>
          {message.type === 'success' ? <CheckCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> :
           message.type === 'error' ? <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : null}
          <span>{message.text}</span>
        </div>
      )}

      {/* Export Section */}
      <div className="mb-6">
        <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">Export</h4>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => handleExport('config')}
            disabled={!!exporting}
            className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:border-brand-300 hover:bg-brand-50/50 transition-colors text-left disabled:opacity-50"
          >
            <div className="p-2 bg-brand-50 rounded-lg">
              <FileJson className="w-5 h-5 text-brand-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900">Config Only</p>
              <p className="text-xs text-gray-500">Campaigns, ICP, settings, users, exclusions</p>
            </div>
            {exporting === 'config' ? <Loader2 className="w-4 h-4 text-brand-500 animate-spin" /> : <Download className="w-4 h-4 text-gray-400" />}
          </button>

          <button
            onClick={() => handleExport('full')}
            disabled={!!exporting}
            className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:border-indigo-300 hover:bg-indigo-50/50 transition-colors text-left disabled:opacity-50"
          >
            <div className="p-2 bg-indigo-50 rounded-lg">
              <Database className="w-5 h-5 text-indigo-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900">Full Backup</p>
              <p className="text-xs text-gray-500">Everything — config + leads, runs, activity</p>
            </div>
            {exporting === 'full' ? <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" /> : <Download className="w-4 h-4 text-gray-400" />}
          </button>
        </div>
      </div>

      {/* Import Section */}
      <div>
        <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">Restore</h4>

        <div className="flex items-center gap-3 mb-3">
          <label className="flex-1 flex items-center gap-3 px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-brand-400 hover:bg-gray-50 transition-colors">
            <Upload className="w-5 h-5 text-gray-400" />
            <div className="flex-1 min-w-0">
              {selectedFile ? (
                <div>
                  <p className="text-sm font-medium text-gray-900 truncate">{selectedFile.name}</p>
                  <p className="text-xs text-gray-500">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                </div>
              ) : (
                <p className="text-sm text-gray-500">Choose a SignalStack export file (.json)</p>
              )}
            </div>
            <input type="file" accept=".json" onChange={handleFileSelect} className="hidden" />
          </label>
        </div>

        {preview && (
          <div className="border border-gray-200 rounded-lg mb-3">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-700">
                  {preview.export_mode === 'full' ? 'Full Backup' : 'Config Only'} — exported {new Date(preview.exported_at).toLocaleDateString()}
                </p>
                <p className="text-xs text-gray-500">{totalRows} total records across {Object.keys(preview.table_counts).length} tables</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                preview.export_mode === 'full' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-brand-50 text-brand-700 border border-brand-200'
              }`}>
                {preview.export_mode}
              </span>
            </div>
            <div className="px-4 py-3 grid grid-cols-3 gap-2">
              {Object.entries(preview.table_counts as Record<string, number>)
                .filter(([, count]) => count > 0)
                .sort(([, a], [, b]) => b - a)
                .map(([table, count]) => (
                  <div key={table} className="flex items-center justify-between text-xs py-1">
                    <span className="text-gray-600">{table.replace(/_/g, ' ')}</span>
                    <span className="font-medium text-gray-900">{count}</span>
                  </div>
                ))
              }
            </div>
          </div>
        )}

        {selectedFile && preview && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 border border-gray-200 rounded-lg p-1">
              <button
                onClick={() => { setImportMode('merge'); setConfirmReplace(false); }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  importMode === 'merge' ? 'bg-brand-100 text-brand-700' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Merge
              </button>
              <button
                onClick={() => { setImportMode('replace'); setConfirmReplace(false); }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  importMode === 'replace' ? 'bg-red-100 text-red-700' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Replace
              </button>
            </div>

            <p className="text-xs text-gray-500 flex-1">
              {importMode === 'merge'
                ? 'Adds new records and updates existing ones. Safe for running instances.'
                : 'Wipes all existing data and imports fresh. Use for clean deploys.'}
            </p>

            {confirmReplace ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-600 font-medium">This will erase all data. Sure?</span>
                <button
                  onClick={handleImport}
                  disabled={importing}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  {importing ? 'Importing...' : 'Yes, Replace'}
                </button>
                <button
                  onClick={() => setConfirmReplace(false)}
                  className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={handleImport}
                disabled={importing}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 ${
                  importMode === 'replace' ? 'bg-red-600 hover:bg-red-700' : 'bg-brand-600 hover:bg-brand-700'
                }`}
              >
                {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                {importing ? 'Importing...' : `Import (${importMode})`}
              </button>
            )}
          </div>
        )}

        {importResult && (
          <div className="mt-3 border border-green-200 rounded-lg bg-green-50 p-3">
            <p className="text-xs font-medium text-green-800 mb-2">Import Results</p>
            <div className="grid grid-cols-3 gap-1">
              {Object.entries(importResult.row_counts as Record<string, { inserted: number; updated: number; skipped: number }>)
                .filter(([, counts]) => counts.inserted > 0 || counts.updated > 0)
                .map(([table, counts]) => (
                  <div key={table} className="text-xs text-green-700 py-0.5">
                    <span className="font-medium">{table.replace(/_/g, ' ')}</span>: {counts.inserted} added
                  </div>
                ))
              }
            </div>
            {importResult.warnings?.length > 0 && (
              <div className="mt-2 pt-2 border-t border-green-200">
                <p className="text-xs font-medium text-amber-700 mb-1">Warnings ({importResult.warnings.length})</p>
                {importResult.warnings.slice(0, 5).map((w: string, i: number) => (
                  <p key={i} className="text-xs text-amber-600">{w}</p>
                ))}
                {importResult.warnings.length > 5 && (
                  <p className="text-xs text-amber-500">...and {importResult.warnings.length - 5} more</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
