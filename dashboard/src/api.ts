const API_BASE = '/api/v1';

// Read session token from server-injected <meta> tag, window global (legacy), or URL query param
function getToken(): string | null {
  return document.querySelector('meta[name="cs-token"]')?.getAttribute('content')
    || (window as any).__CS_TOKEN
    || new URLSearchParams(window.location.search).get('token')
    || null;
}

export async function fetchApi<T>(path: string, params?: Record<string, string>): Promise<T> {
  // Normalize: if caller passes '/api/foo', strip the /api prefix
  const cleanPath = path.replace(/^\/api\//, '/');
  const url = new URL(`${API_BASE}${cleanPath}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(url.toString(), { headers });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function postApi<T>(path: string, body?: any, extraHeaders?: Record<string, string>): Promise<T> {
  const cleanPath = path.replace(/^\/api\//, '/');
  const url = `${API_BASE}${cleanPath}`;
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extraHeaders };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  
  const options: RequestInit = { method: 'POST', headers };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function deleteApi<T>(path: string): Promise<T> {
  const cleanPath = path.replace(/^\/api\//, '/');
  const url = `${API_BASE}${cleanPath}`;
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  
  const res = await fetch(url, { method: 'DELETE', headers });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function fetchDiff(sessionId: number, filePath?: string): Promise<string> {
  const token = getToken();
  const params = new URLSearchParams();
  if (filePath) params.set('file', filePath);
  if (token) params.set('token', token);
  // Use relative URL to avoid mixed content issues (HTTPS page -> HTTP fetch)
  const url = `/api/v1/sessions/${sessionId}/diff?${params}`;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(body || `Diff API ${res.status}`);
  }
  return res.text();
}

export async function fetchCommitDiff(sessionId: number, hash: string, filePath?: string): Promise<string> {
  const token = getToken();
  const params = new URLSearchParams();
  if (filePath) params.set('file', filePath);
  if (token) params.set('token', token);
  // Use relative URL to avoid mixed content issues (HTTPS page -> HTTP fetch)
  const url = `/api/v1/sessions/${sessionId}/commits/${hash}/diff?${params}`;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(body || `Diff API ${res.status}`);
  }
  return res.text();
}

export interface DiffStat {
  filePath: string;
  additions: number;
  deletions: number;
}

export async function fetchDiffStats(sessionId: number): Promise<DiffStat[]> {
  return fetchApi<DiffStat[]>(`/api/sessions/${sessionId}/diff-stats`);
}
