import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { formatDate } from '../utils/dates';
import {
  Building2,
  Search,
  DollarSign,
  Package,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from 'lucide-react';

interface CustomerProfile {
  id: string;
  company_name: string;
  domain: string | null;
  products_used: string[];
  environment: Record<string, any>;
  why_they_bought: string | null;
  deal_value: string | null;
  close_date: string | null;
  original_lead_id: string | null;
  campaign_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface AggregateData {
  product_usage: [string, number][];
  environment_patterns: Record<string, Record<string, number>>;
  buy_reasons: string[];
}

export function Customers() {
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [aggregate, setAggregate] = useState<AggregateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    api('/analytics/customer-intel')
      .then((data: any) => {
        setCustomers(data.customers || []);
        setAggregate(data.aggregate || null);
      })
      .catch(() => setCustomers([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = search
    ? customers.filter(c =>
        c.company_name.toLowerCase().includes(search.toLowerCase()) ||
        (c.domain || '').toLowerCase().includes(search.toLowerCase())
      )
    : customers;

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Customer Knowledge Base</h1>
        <p className="text-sm text-gray-500 mt-1">
          Profiles built from closed-won deals and existing customer feedback. Use to refine your ICP.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Building2 className="w-4 h-4" />
            Total Customers
          </div>
          <p className="text-2xl font-bold text-gray-900">{customers.length}</p>
        </div>
        {aggregate && aggregate.product_usage.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <Package className="w-4 h-4" />
              Top Product
            </div>
            <p className="text-2xl font-bold text-gray-900">{aggregate.product_usage[0][0]}</p>
            <p className="text-xs text-gray-400">{aggregate.product_usage[0][1]} customer{aggregate.product_usage[0][1] !== 1 ? 's' : ''}</p>
          </div>
        )}
        {aggregate && aggregate.buy_reasons.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <MessageSquare className="w-4 h-4" />
              Buy Reasons Collected
            </div>
            <p className="text-2xl font-bold text-gray-900">{aggregate.buy_reasons.length}</p>
          </div>
        )}
      </div>

      {/* Aggregate Patterns */}
      {aggregate && (aggregate.product_usage.length > 0 || aggregate.buy_reasons.length > 0) && (
        <div className="grid grid-cols-2 gap-4">
          {aggregate.product_usage.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-semibold text-sm text-gray-900 mb-3 flex items-center gap-2">
                <Package className="w-4 h-4 text-brand-600" />
                Product Adoption
              </h3>
              <div className="space-y-2">
                {aggregate.product_usage.map(([product, count]) => (
                  <div key={product} className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">{product}</span>
                    <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-brand-50 text-brand-700">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {aggregate.buy_reasons.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-semibold text-sm text-gray-900 mb-3 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-green-600" />
                Why They Bought
              </h3>
              <ul className="space-y-1.5">
                {aggregate.buy_reasons.slice(0, 8).map((reason, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Customer List */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search customers..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
            />
          </div>
          <span className="text-xs text-gray-400">{filtered.length} customer{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-16">
            <Building2 className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">
              {customers.length === 0
                ? 'No customer profiles yet. Mark leads as "Closed Won" or "Existing Customer" to build your knowledge base.'
                : 'No customers match your search.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filtered.map(customer => (
              <CustomerRow
                key={customer.id}
                customer={customer}
                expanded={expandedId === customer.id}
                onToggle={() => setExpandedId(expandedId === customer.id ? null : customer.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CustomerRow({ customer, expanded, onToggle }: {
  customer: CustomerProfile;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <button onClick={onToggle} className="w-full px-5 py-3 flex items-center gap-4 text-left hover:bg-gray-50 transition-colors">
        <div className="w-9 h-9 rounded-lg bg-purple-50 flex items-center justify-center flex-shrink-0">
          <Building2 className="w-4 h-4 text-purple-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-gray-900">{customer.company_name}</span>
            {customer.domain && (
              <span className="text-xs text-gray-400">{customer.domain}</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            {customer.deal_value && (
              <span className="flex items-center gap-1 text-xs text-green-600">
                <DollarSign className="w-3 h-3" />
                {customer.deal_value}
              </span>
            )}
            {customer.products_used.length > 0 && (
              <span className="text-xs text-gray-400">{customer.products_used.length} product{customer.products_used.length !== 1 ? 's' : ''}</span>
            )}
            {customer.close_date && (
              <span className="text-xs text-gray-400">Closed {formatDate(customer.close_date)}</span>
            )}
          </div>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>

      {expanded && (
        <div className="px-5 pb-4 ml-12 space-y-3 border-t border-gray-50">
          <div className="grid grid-cols-2 gap-4 pt-3">
            {customer.products_used.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Products Used</h4>
                <div className="flex flex-wrap gap-1.5">
                  {customer.products_used.map((p, i) => (
                    <span key={i} className="px-2.5 py-1 rounded-full text-xs font-medium bg-purple-50 text-purple-700">{p}</span>
                  ))}
                </div>
              </div>
            )}
            {Object.keys(customer.environment).length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Environment</h4>
                <div className="space-y-1">
                  {Object.entries(customer.environment).map(([key, val]) => (
                    <p key={key} className="text-xs text-gray-600">
                      <span className="font-medium">{key}:</span> {String(val)}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
          {customer.why_they_bought && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Why They Bought</h4>
              <p className="text-sm text-gray-700">{customer.why_they_bought}</p>
            </div>
          )}
          {customer.notes && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Notes</h4>
              <p className="text-sm text-gray-600">{customer.notes}</p>
            </div>
          )}
          <div className="flex items-center gap-3 pt-1">
            <span className="text-[10px] text-gray-400">Added {formatDate(customer.created_at)}</span>
            {customer.original_lead_id && (
              <Link to={`/leads/${customer.original_lead_id}`} className="flex items-center gap-1 text-[10px] text-brand-600 hover:underline">
                <ExternalLink className="w-3 h-3" />
                View original lead
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
