import { useState, useEffect, useCallback } from 'react';
import { api, setToken, clearToken } from '../api/client';
import { setUserTimezone } from '../utils/dates';

interface User {
  id: string;
  email: string;
  display_name: string;
  role: 'superadmin' | 'admin' | 'operator' | 'member' | 'viewer';
  must_change_password?: boolean;
  timezone?: string | null;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('pg_token');
    if (!token) { setLoading(false); return; }

    api<User>('/auth/me')
      .then(u => {
        setUser(u);
        if (u.timezone) setUserTimezone(u.timezone);
      })
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const data = await api<{ token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, timezone: browserTz }),
    });
    setToken(data.token);
    setUser(data.user);
    if (data.user.timezone) setUserTimezone(data.user.timezone);
    return data.user;
  }, []);

  const register = useCallback(async (email: string, password: string, display_name: string, invite_token?: string) => {
    const data = await api<{ token: string; user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, display_name, invite_token }),
    });
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  const updateUser = useCallback((updates: Partial<User>) => {
    setUser(prev => prev ? { ...prev, ...updates } : null);
  }, []);

  return { user, loading, login, register, logout, updateUser };
}
