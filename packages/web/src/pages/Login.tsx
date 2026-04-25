import { useState, useEffect } from 'react';
import { useAuthContext } from '../App';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { Zap, Mail, ShieldCheck } from 'lucide-react';

export function Login() {
  const { login, register } = useAuthContext();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('invite');

  const [isRegister, setIsRegister] = useState(!!inviteToken);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Registration info
  const [regInfo, setRegInfo] = useState<{ self_registration: boolean; is_first_user: boolean } | null>(null);
  const [inviteInfo, setInviteInfo] = useState<{ email: string; role: string } | null>(null);

  useEffect(() => {
    api('/auth/registration-info').then((data: any) => setRegInfo(data)).catch(() => {});
    if (inviteToken) {
      api(`/auth/invite/${inviteToken}`).then((data: any) => {
        setInviteInfo(data);
        setEmail(data.email);
      }).catch((err: any) => {
        setError(err.message || 'Invalid invite link');
      });
    }
  }, [inviteToken]);

  const canRegister = regInfo?.is_first_user || regInfo?.self_registration || !!inviteToken;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isRegister) {
        await register(email, password, displayName, inviteToken || undefined);
      } else {
        await login(email, password);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Zap className="w-8 h-8 text-brand-400" />
            <h1 className="text-2xl font-bold text-white">SignalStack</h1>
          </div>
          <p className="text-gray-400">Stack signals from 14+ sources. Qualify leads with AI. Arm your reps with intelligence briefs.</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-lg p-8 space-y-4">
          {inviteInfo ? (
            <div className="text-center space-y-2">
              <div className="flex items-center justify-center gap-2">
                <Mail className="w-5 h-5 text-brand-500" />
                <h2 className="text-xl font-semibold">You're Invited</h2>
              </div>
              <p className="text-sm text-gray-500">
                Join as <span className="font-medium text-gray-700 capitalize">{inviteInfo.role}</span>
              </p>
            </div>
          ) : regInfo?.is_first_user ? (
            <div className="text-center space-y-2">
              <div className="flex items-center justify-center gap-2">
                <ShieldCheck className="w-5 h-5 text-purple-500" />
                <h2 className="text-xl font-semibold">Create Super Admin</h2>
              </div>
              <p className="text-sm text-gray-500">
                First account gets full control of SignalStack
              </p>
            </div>
          ) : (
            <h2 className="text-xl font-semibold text-center">
              {isRegister ? 'Create Account' : 'Sign In'}
            </h2>
          )}

          {error && (
            <div className="bg-red-50 text-red-700 px-4 py-2 rounded-lg text-sm">{error}</div>
          )}

          {isRegister && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                required
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              required
              readOnly={!!inviteInfo}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              required
              minLength={6}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 font-medium transition-colors"
          >
            {loading ? 'Loading...' : isRegister ? (regInfo?.is_first_user ? 'Create Super Admin Account' : 'Create Account') : 'Sign In'}
          </button>

          {!inviteInfo && (
            <p className="text-center text-sm text-gray-500">
              {isRegister ? (
                <>
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => { setIsRegister(false); setError(''); }}
                    className="text-brand-600 hover:text-brand-700 font-medium"
                  >
                    Sign in
                  </button>
                </>
              ) : canRegister ? (
                <>
                  Don't have an account?{' '}
                  <button
                    type="button"
                    onClick={() => { setIsRegister(true); setError(''); }}
                    className="text-brand-600 hover:text-brand-700 font-medium"
                  >
                    Register
                  </button>
                </>
              ) : (
                <span className="text-gray-400">
                  Registration is by invite only. Contact your admin.
                </span>
              )}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
