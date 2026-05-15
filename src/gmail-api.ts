import { getAccessToken } from './auth.ts';

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

export async function gmailApi<T = any>(
  path: string,
  opts?: { method?: string; body?: unknown; query?: Record<string, string | string[]>; userEmail?: string },
): Promise<T> {
  const token = await getAccessToken(opts?.userEmail);
  const method = opts?.method ?? 'GET';
  const url = new URL(`${BASE}/${path}`);
  if (opts?.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v === undefined || v === '') continue;
      const values = Array.isArray(v) ? v : [v];
      for (const item of values) {
        if (item !== undefined && item !== '') url.searchParams.append(k, item);
      }
    }
  }

  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(opts?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail API ${method} ${path}: ${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}
