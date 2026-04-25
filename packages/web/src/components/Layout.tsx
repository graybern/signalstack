import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuthContext } from '../App';
import {
  LayoutDashboard,
  Target,
  History,
  Download,
  Upload,
  Users,
  Settings,
  LogOut,
  Zap,
  User,
  Building2,
  AppWindow,
  ChevronDown,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { permissions } from '../utils/permissions';

type NavItem = { to: string; icon: typeof LayoutDashboard; label: string; end?: boolean };
type NavSection = { label: string; items: NavItem[] };

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  superadmin: { label: 'Super Admin', color: 'bg-purple-500/20 text-purple-300' },
  admin: { label: 'Admin', color: 'bg-red-500/20 text-red-300' },
  operator: { label: 'Operator', color: 'bg-amber-500/20 text-amber-300' },
  member: { label: 'Member', color: 'bg-blue-500/20 text-blue-300' },
  viewer: { label: 'Viewer', color: 'bg-gray-500/20 text-gray-300' },
};

export function Layout() {
  const { user, logout } = useAuthContext();
  const navigate = useNavigate();
  const role = user?.role;

  const navSections: NavSection[] = [
    {
      label: 'Intelligence',
      items: [
        { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
        { to: '/campaigns', icon: Target, label: 'Campaigns' },
        { to: '/leads', icon: Users, label: 'Leads' },
        { to: '/runs', icon: History, label: 'Run History' },
      ],
    },
    ...(permissions.canViewConnect(role) ? [{
      label: 'Connect',
      items: [
        { to: '/import', icon: Download, label: 'Import' },
        ...(permissions.canExport(role) ? [{ to: '/export', icon: Upload, label: 'Export' }] : []),
      ],
    }] : []),
  ];
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const roleInfo = ROLE_LABELS[user?.role] || ROLE_LABELS.member;

  return (
    <div className="h-screen flex overflow-hidden">
      {/* Sidebar — fixed height, internal scroll if needed */}
      <aside className="w-64 bg-gray-900 text-white flex flex-col h-screen shrink-0">
        {/* Brand — fixed top */}
        <div className="px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-brand-400" />
            <h1 className="text-base font-bold tracking-tight">SignalStack</h1>
          </div>
          <p className="text-[10px] text-gray-500 mt-0.5 tracking-wide uppercase">
            Buying Signal Intelligence
          </p>
        </div>

        {/* Navigation — scrollable if content overflows */}
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          {navSections.map((section) => (
            <div key={section.label}>
              <p className="px-3 mb-1 text-[10px] font-semibold text-gray-500 uppercase tracking-widest">
                {section.label}
              </p>
              <div className="space-y-0.5">
                {section.items.map(({ to, icon: Icon, label, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                        isActive
                          ? 'bg-brand-600 text-white font-medium'
                          : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                      }`
                    }
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* User section — fixed bottom, never scrolls away */}
        <div className="border-t border-gray-800 p-3 shrink-0" ref={menuRef}>
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-gray-800 transition-colors text-left"
          >
            <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center shrink-0">
              <span className="text-xs font-medium text-gray-300">
                {(user?.display_name || 'U').charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate text-gray-200">
                {user?.display_name}
              </p>
              <div className="flex items-center gap-1.5">
                <span className={`text-[10px] px-1.5 py-0 rounded-full font-medium ${roleInfo.color}`}>
                  {roleInfo.label}
                </span>
              </div>
            </div>
            <ChevronDown className={`w-3.5 h-3.5 text-gray-500 transition-transform ${showUserMenu ? 'rotate-180' : ''}`} />
          </button>

          {/* User dropdown menu */}
          {showUserMenu && (
            <div className="mt-1 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden shadow-lg">
              <div className="px-3 py-2 border-b border-gray-700">
                <p className="text-xs text-gray-400 truncate">{user?.email}</p>
              </div>
              {permissions.canAccessSettings(role) && (
                <button
                  onClick={() => { navigate('/settings/org'); setShowUserMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
                >
                  <Building2 className="w-3.5 h-3.5" />
                  Org Settings
                </button>
              )}
              <button
                onClick={() => { navigate('/settings/profile'); setShowUserMenu(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
              >
                <User className="w-3.5 h-3.5" />
                Profile
              </button>
              {permissions.canAccessSettings(role) && (
                <button
                  onClick={() => { navigate('/settings/app'); setShowUserMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
                >
                  <AppWindow className="w-3.5 h-3.5" />
                  App Settings
                </button>
              )}
              <div className="border-t border-gray-700">
                <button
                  onClick={() => { logout(); setShowUserMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Main content — independently scrollable */}
      <main className="flex-1 overflow-auto bg-gray-50">
        <div className="max-w-7xl mx-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
