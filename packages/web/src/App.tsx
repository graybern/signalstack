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
import React, { createContext, useContext } from 'react';

interface AuthContextType {
  user: any;
  login: (email: string, password: string) => Promise<any>;
  register: (email: string, password: string, display_name: string, invite_token?: string) => Promise<any>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextType>(null!);
export const useAuthContext = () => useContext(AuthContext);

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthContext();
  if (!user) return <Navigate to="/login" replace />;
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
