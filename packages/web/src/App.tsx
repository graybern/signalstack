import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { LeadDetail } from './pages/LeadDetail';
import { Leads } from './pages/Leads';
import { Settings } from './pages/Settings';
import { RunHistory } from './pages/RunHistory';
import { RunDetail } from './pages/RunDetail';
import { ExportPage } from './pages/ExportPage';
import { Campaigns } from './pages/Campaigns';
import { CampaignDetail } from './pages/CampaignDetail';
import { CampaignCreate } from './pages/CampaignCreate';
import { Inbound } from './pages/Inbound';
import { ActivityLog } from './pages/ActivityLog';
import { QuickResearch } from './pages/QuickResearch';
import React, { createContext, useContext, useState } from 'react';
import { api } from './api/client';
import { Zap, Lock } from 'lucide-react';

interface AuthContextType {
  user: any;
  login: (email: string, password: string) => Promise<any>;
  register: (email: string, password: string, display_name: string, invite_token?: string) => Promise<any>;
  logout: () => void;
  updateUser: (updates: Partial<any>) => void;
}

export const AuthContext = createContext<AuthContextType>(null!);
export const useAuthContext = () => useContext(AuthContext);

function ForcePasswordChange() {
  const { updateUser } = useAuthContext();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (pw !== confirm) { setError('Passwords do not match'); return; }
    setSaving(true);
    setError('');
    try {
      await api('/auth/force-change-password', { method: 'POST', body: JSON.stringify({ new_password: pw }) });
      updateUser({ must_change_password: false });
    } catch (err: any) {
      setError(err.message || 'Failed to change password');
    } finally { setSaving(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Zap className="w-8 h-8 text-brand-400" />
            <h1 className="text-2xl font-bold text-white">SignalStack</h1>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-lg p-8 space-y-4">
          <div className="text-center space-y-2">
            <div className="flex items-center justify-center gap-2">
              <Lock className="w-5 h-5 text-brand-500" />
              <h2 className="text-xl font-semibold">Set Your Password</h2>
            </div>
            <p className="text-sm text-gray-500">Your account requires a password change before continuing.</p>
          </div>
          {error && <div className="bg-red-50 text-red-700 px-4 py-2 rounded-lg text-sm">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
            <input type="password" value={pw} onChange={e => setPw(e.target.value)} required minLength={6}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500" placeholder="Min 6 characters" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required minLength={6}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
          <button type="submit" disabled={saving}
            className="w-full py-2 px-4 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 font-medium">
            {saving ? 'Saving...' : 'Set Password & Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthContext();
  if (!user) return <Navigate to="/login" replace />;
  if (user.must_change_password) return <ForcePasswordChange />;
  return <>{children}</>;
}

export default function App() {
  const auth = useAuth();

  if (auth.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500" />
      </div>
    );
  }

  return (
    <AuthContext.Provider value={auth}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={auth.user ? <Navigate to="/" replace /> : <Login />} />
          <Route path="/register" element={auth.user ? <Navigate to="/" replace /> : <Login />} />
          <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            {/* Intelligence */}
            <Route index element={<Dashboard />} />
            <Route path="campaigns" element={<Campaigns />} />
            <Route path="campaigns/new" element={<CampaignCreate />} />
            <Route path="campaigns/:id" element={<CampaignDetail />} />
            <Route path="campaigns/:id/edit" element={<CampaignCreate />} />
            <Route path="leads" element={<Leads />} />
            <Route path="leads/:id" element={<LeadDetail />} />
            <Route path="runs" element={<RunHistory />} />
            <Route path="runs/:id" element={<RunDetail />} />
            <Route path="research" element={<QuickResearch />} />
            <Route path="activity" element={<ActivityLog />} />
            {/* Connect */}
            <Route path="import" element={<Inbound />} />
            <Route path="export" element={<ExportPage />} />
            {/* Settings (from user dropdown) */}
            <Route path="settings/org" element={<Settings tab="org" />} />
            <Route path="settings/profile" element={<Settings tab="profile" />} />
            <Route path="settings/app" element={<Settings tab="app" />} />
            <Route path="settings" element={<Navigate to="/settings/org" replace />} />
            {/* Backwards compat redirects */}
            <Route path="icp" element={<Navigate to="/settings/org" replace />} />
            <Route path="exclusions" element={<Navigate to="/settings/org" replace />} />
            <Route path="integrations" element={<Navigate to="/export" replace />} />
            <Route path="inbound" element={<Navigate to="/import" replace />} />
            <Route path="profile" element={<Navigate to="/settings/profile" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthContext.Provider>
  );
}
