import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { useAuthContext } from '../App';
import { permissions } from '../utils/permissions';
import {
  History, ChevronDown, ChevronUp, RotateCcw, Filter,
  User, Target, Shield, Settings, Users, FileX,
  ArrowRight, Loader2, Package,
} from 'lucide-react';

interface ActivityEntry {
  id: string;
  user_id: string;
  entity_type: string;
  entity_id: string;
  entity_title: string | null;
  action: string;
  changes: Record<string, { old: unknown; new: unknown }> | null;
  snapshot: Record<string, unknown> | null;
  created_at: string;
  user: { display_name: string; email: string };
}

const ENTITY_ICONS: Record<string, typeof Target> = {
  campaign: Target,
  lead: Users,
  exclusion: FileX,
  icp_config: Shield,
  user: User,
  setting: Settings,
  import: Package,
};

const ACTION_COLORS: Record<string, string> = {
  created: 'bg-green-100 text-green-700',
  updated: 'bg-blue-100 text-blue-700',
  deleted: 'bg-red-100 text-red-700',
  reverted: 'bg-amber-100 text-amber-700',
};

const ENTITY_LABELS: Record<string, string> = {
  campaign: 'Campaign',
  lead: 'Lead',
  exclusion: 'Exclusion',
  icp_config: 'ICP Config',
  user: 'User',
  setting: 'Setting',
  import: 'Import',
};

const PAGE_SIZE = 30;

export function ActivityLog() {
  const { user } = useAuthContext();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reverting, setReverting] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>('');
  const [filterUser, setFilterUser] = useState<string>('');

  const canRevert = permissions.canAccessSettings(user?.role);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(page * PAGE_SIZE));
      if (filterType) params.set('entity_type', filterType);
      if (filterUser) params.set('user_id', filterUser);

      const data = await api.get<{ entries: ActivityEntry[]; total: number }>(
        `/activity?${params}`
      );
      setEntries(data.entries);
      setTotal(data.total);
    } catch (err) {
      console.error('Failed to fetch activity log:', err);
    } finally {
      setLoading(false);
    }
  }, [page, filterType, filterUser]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const handleRevert = async (entryId: string) => {
    if (!confirm('Revert this change? The entity will be restored to the snapshot captured at that time.')) return;
    setReverting(entryId);
    try {
      await api.post(`/activity/${entryId}/revert`);
      await fetchEntries();
    } catch (err: any) {
      alert(err.message || 'Revert failed');
    } finally {
      setReverting(null);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const formatValue = (val: unknown): string => {
    if (val === null || val === undefined) return 'null';
    if (typeof val === 'object') return JSON.stringify(val, null, 2);
    return String(val);
  };

  const timeAgo = (dateStr: string): string => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <History className="w-6 h-6 text-gray-400" />
            Activity Log
          </h1>
          <p className="text-sm text-gray-500 mt-1">{total} entries</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select
            value={filterType}
            onChange={e => { setFilterType(e.target.value); setPage(0); }}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white"
          >
            <option value="">All types</option>
            {Object.entries(ENTITY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Timeline */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No activity recorded yet.
        </div>
      ) : (
        <div className="space-y-1">
          {entries.map(entry => {
            const Icon = ENTITY_ICONS[entry.entity_type] || Settings;
            const isExpanded = expandedId === entry.id;
            const actionColor = ACTION_COLORS[entry.action] || 'bg-gray-100 text-gray-700';

            return (
              <div key={entry.id} className="bg-white border border-gray-200 rounded-lg">
                <button
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                >
                  <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4 text-gray-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-900">
                        {entry.user.display_name}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${actionColor}`}>
                        {entry.action}
                      </span>
                      <span className="text-sm text-gray-600">
                        {ENTITY_LABELS[entry.entity_type] || entry.entity_type}
                      </span>
                      {entry.entity_title && (
                        <span className="text-sm font-medium text-gray-800 truncate max-w-[200px]">
                          {entry.entity_title}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {timeAgo(entry.created_at)} &middot; {new Date(entry.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {canRevert && entry.snapshot && entry.action !== 'reverted' && (
                      <button
                        onClick={e => { e.stopPropagation(); handleRevert(entry.id); }}
                        disabled={reverting === entry.id}
                        className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50 flex items-center gap-1"
                        title="Revert to this snapshot"
                      >
                        {reverting === entry.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <RotateCcw className="w-3 h-3" />
                        )}
                        Revert
                      </button>
                    )}
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-gray-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-gray-400" />
                    )}
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-gray-100">
                    {entry.changes && Object.keys(entry.changes).length > 0 && (
                      <div className="mt-3">
                        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Changes</h4>
                        <div className="space-y-2">
                          {Object.entries(entry.changes).map(([field, { old: oldVal, new: newVal }]) => (
                            <div key={field} className="text-sm">
                              <span className="font-mono text-xs text-gray-500">{field}</span>
                              <div className="flex items-start gap-2 mt-0.5 ml-2">
                                <span className="bg-red-50 text-red-700 px-2 py-0.5 rounded text-xs font-mono whitespace-pre-wrap max-w-[45%] overflow-auto">
                                  {formatValue(oldVal)}
                                </span>
                                <ArrowRight className="w-3 h-3 text-gray-400 mt-1 shrink-0" />
                                <span className="bg-green-50 text-green-700 px-2 py-0.5 rounded text-xs font-mono whitespace-pre-wrap max-w-[45%] overflow-auto">
                                  {formatValue(newVal)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {entry.snapshot && (
                      <details className="mt-3">
                        <summary className="text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-700">
                          Snapshot
                        </summary>
                        <pre className="mt-2 text-xs font-mono bg-gray-50 rounded-lg p-3 overflow-auto max-h-60 text-gray-700">
                          {JSON.stringify(entry.snapshot, null, 2)}
                        </pre>
                      </details>
                    )}

                    {!entry.changes && !entry.snapshot && (
                      <p className="text-sm text-gray-400 mt-3 italic">No diff or snapshot recorded.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-gray-500">
            Page {page + 1} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-50"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
