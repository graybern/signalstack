import { useState } from 'react';
import { useAuthContext } from '../App';
import { api } from '../api/client';
import {
  User,
  Key,
  Pencil,
  Crown,
  Eye,
  Wrench,
  UserCog,
  ShieldCheck,
} from 'lucide-react';

const ROLE_META: Record<string, { icon: any; label: string; color: string; bg: string; description: string }> = {
  superadmin: { icon: ShieldCheck, label: 'Super Admin', color: 'text-purple-600', bg: 'bg-purple-50 border-purple-200', description: 'Ultimate authority — manages admins, system-wide settings, cannot be demoted by admins' },
  admin: { icon: Crown, label: 'Admin', color: 'text-red-600', bg: 'bg-red-50 border-red-200', description: 'Full access — user management, system settings, webhooks, API keys' },
  operator: { icon: Wrench, label: 'Operator', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', description: 'Configure ICP, prompts, data sources, exclusions, campaign settings' },
  member: { icon: UserCog, label: 'Member', color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200', description: 'Run campaigns, import leads, provide feedback, export data' },
  viewer: { icon: Eye, label: 'Viewer', color: 'text-gray-600', bg: 'bg-gray-50 border-gray-200', description: 'Read-only access to leads, briefs, dashboards, and run history' },
};

export function Profile() {
  const { user } = useAuthContext();
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const roleMeta = ROLE_META[user?.role || 'member'] || ROLE_META.member;
  const RoleIcon = roleMeta.icon;

  const handleSaveProfile = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const body: any = {};
      if (displayName !== user?.display_name) body.display_name = displayName;
      if (newPassword) {
        if (newPassword !== confirmPassword) {
          setMessage({ type: 'error', text: 'Passwords do not match' });
          setSaving(false);
          return;
        }
        body.current_password = currentPassword;
        body.new_password = newPassword;
      }
      if (Object.keys(body).length === 0) {
        setMessage({ type: 'error', text: 'No changes to save' });
        setSaving(false);
        return;
      }
      await api('/users/profile', { method: 'PUT', body: JSON.stringify(body) });
      setMessage({ type: 'success', text: 'Profile updated successfully' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      window.location.reload();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to update profile' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Profile</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your account settings</p>
      </div>

      <div className="max-w-2xl space-y-6">
        {/* Role badge */}
        <div className={`border rounded-lg p-4 flex items-center gap-4 ${roleMeta.bg}`}>
          <div className={`p-2 rounded-lg bg-white/60 ${roleMeta.color}`}>
            <RoleIcon className="w-5 h-5" />
          </div>
          <div>
            <p className="font-medium text-gray-900">
              Your role: <span className={roleMeta.color}>{roleMeta.label}</span>
            </p>
            <p className="text-sm text-gray-600">{roleMeta.description}</p>
          </div>
        </div>

        {/* Profile info */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
            <Pencil className="w-4 h-4" />
            Profile Information
          </h3>

          {message && (
            <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${
              message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              {message.text}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={user?.email || ''}
                disabled
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-500"
              />
              <p className="text-xs text-gray-400 mt-1">Email cannot be changed</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
          </div>
        </div>

        {/* Password change */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
            <Key className="w-4 h-4" />
            Change Password
          </h3>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                placeholder="Enter current password"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="Min 6 characters"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="Re-enter new password"
                />
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={handleSaveProfile}
          disabled={saving}
          className="px-6 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
