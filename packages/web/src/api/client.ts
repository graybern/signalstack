const BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('pg_token');
}

export function setToken(token: string) {
  localStorage.setItem('pg_token', token);
}

export function clearToken() {
  localStorage.removeItem('pg_token');
}

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  // Don't set Content-Type for FormData
  if (options.body instanceof FormData) {
    delete headers['Content-Type'];
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    clearToken();
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }

  // Handle CSV/Markdown downloads
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/csv') || ct.includes('text/markdown') || ct.includes('application/rss+xml')) {
    return res.text() as any;
  }

  return res.json();
}

// Convenience methods
api.get = <T = any>(path: string) => api<T>(path);
api.post = <T = any>(path: string, body?: any) =>
  api<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined });
api.put = <T = any>(path: string, body?: any) =>
  api<T>(path, { method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined });
api.delete = <T = any>(path: string) => api<T>(path, { method: 'DELETE' });

export function downloadFile(path: string, filename: string) {
  const token = getToken();
  fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
    .then(res => res.blob())
    .then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    });
}
