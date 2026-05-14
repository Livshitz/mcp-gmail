import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { JwtHelper } from 'edge.libx.js/build/helpers/jwt.js';

const GMAIL_SCOPE = 'https://mail.google.com/';
const TOKEN_DIR = join(homedir(), '.mcp-gmail', 'tokens');
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

// ── Helpers ─────────────────────────────────────────────────────────────────

export function loadServiceAccount(value: string): any {
  if (value.trim().startsWith('{')) return JSON.parse(value);
  const filePath = resolve(process.cwd(), value);
  if (!existsSync(filePath)) throw new Error(`Service account file not found: ${filePath}`);
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

export function getDefaultUserEmail(): string {
  return process.env.GMAIL_USER_EMAIL?.trim() ?? '';
}

export function resolveUserEmail(explicit?: string): string {
  const email = explicit?.trim() || getDefaultUserEmail();
  if (!email) throw new Error('No user_email provided and GMAIL_USER_EMAIL is not set');
  return email;
}

export function requireConfig() {
  const saValue = process.env.GOOGLE_SERVICE_ACCOUNT?.trim();
  if (!saValue) throw new Error('GOOGLE_SERVICE_ACCOUNT is not set');
  const userEmail = resolveUserEmail();
  return { saValue, userEmail };
}

// ── OAuth2 token storage ────────────────────────────────────────────────────

interface OAuthToken {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

function tokenPath(email: string): string {
  return join(TOKEN_DIR, `${email}.json`);
}

function loadOAuthToken(email: string): OAuthToken | null {
  try {
    const p = tokenPath(email);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch { return null; }
}

function saveOAuthToken(email: string, token: OAuthToken): void {
  if (!existsSync(TOKEN_DIR)) mkdirSync(TOKEN_DIR, { recursive: true });
  writeFileSync(tokenPath(email), JSON.stringify(token, null, 2));
}

function getOAuthClientConfig(): { clientId: string; clientSecret: string } | null {
  const id = process.env.GMAIL_OAUTH_CLIENT_ID?.trim();
  const secret = process.env.GMAIL_OAUTH_CLIENT_SECRET?.trim();
  if (id && secret) return { clientId: id, clientSecret: secret };

  const credPath = process.env.GMAIL_OAUTH_CREDENTIALS?.trim();
  if (!credPath) return null;
  try {
    const data = JSON.parse(readFileSync(resolve(process.cwd(), credPath), 'utf-8'));
    const creds = data.installed || data.web;
    if (creds) return { clientId: creds.client_id, clientSecret: creds.client_secret };
  } catch { /* ignore */ }
  return null;
}

async function refreshOAuthAccessToken(email: string): Promise<string> {
  const client = getOAuthClientConfig();
  if (!client) throw new Error('OAuth client not configured (set GMAIL_OAUTH_CLIENT_ID/SECRET or GMAIL_OAUTH_CREDENTIALS)');

  const stored = loadOAuthToken(email);
  if (!stored?.refresh_token) throw new Error(`No OAuth token for ${email}. Run: bun run src/mcp/cli.ts --auth ${email}`);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: stored.refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth token refresh failed for ${email}: ${res.status} ${text}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number; refresh_token?: string };
  const updated: OAuthToken = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || stored.refresh_token,
    expires_at: Date.now() + (data.expires_in - 60) * 1000,
  };
  saveOAuthToken(email, updated);
  return data.access_token;
}

// ── Interactive auth flow (--auth) ──────────────────────────────────────────

export async function runAuthFlow(email: string): Promise<void> {
  const client = getOAuthClientConfig();
  if (!client) {
    console.error('OAuth client not configured. Set one of:');
    console.error('  GMAIL_OAUTH_CREDENTIALS=./client_secret.json');
    console.error('  GMAIL_OAUTH_CLIENT_ID + GMAIL_OAUTH_CLIENT_SECRET');
    process.exit(1);
  }

  const port = 18439 + Math.floor(Math.random() * 100);
  const redirectUri = `http://localhost:${port}/callback`;

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', client.clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', GMAIL_SCOPE);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('login_hint', email);

  console.log(`\nAuthenticating ${email}...\n`);
  console.log(`Opening browser. If it doesn't open, visit:\n${authUrl.toString()}\n`);

  const { exec } = await import('node:child_process');
  const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${openCmd} "${authUrl.toString()}"`);

  const code = await new Promise<string>((resolve, reject) => {
    const server = Bun.serve({
      port,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== '/callback') return new Response('Not found', { status: 404 });

        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          reject(new Error(`Auth denied: ${error}`));
          setTimeout(() => server.stop(), 100);
          return new Response('<html><body><h2>Authentication failed.</h2><p>You can close this tab.</p></body></html>', { headers: { 'Content-Type': 'text/html' } });
        }

        if (!code) {
          reject(new Error('No code in callback'));
          setTimeout(() => server.stop(), 100);
          return new Response('Missing code', { status: 400 });
        }

        resolve(code);
        setTimeout(() => server.stop(), 100);
        return new Response('<html><body><h2>✓ Authenticated!</h2><p>You can close this tab.</p></body></html>', { headers: { 'Content-Type': 'text/html' } });
      },
    });

    setTimeout(() => { reject(new Error('Auth timed out (60s)')); server.stop(); }, 60_000);
  });

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Token exchange failed: ${tokenRes.status} ${text}`);
  }

  const data = await tokenRes.json() as { access_token: string; refresh_token: string; expires_in: number };
  saveOAuthToken(email, {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in - 60) * 1000,
  });

  console.log(`✓ Token saved for ${email} at ${tokenPath(email)}`);
}

// ── Account listing ────────────────────────────────────────────────────────

export interface AccountInfo {
  email: string;
  authMethod: 'service-account' | 'oauth';
  isDefault: boolean;
}

export function listAccounts(): AccountInfo[] {
  const accounts: AccountInfo[] = [];
  const defaultEmail = getDefaultUserEmail();

  // Service account (Workspace) — just the default email if configured
  if (defaultEmail && process.env.GOOGLE_SERVICE_ACCOUNT?.trim()) {
    accounts.push({ email: defaultEmail, authMethod: 'service-account', isDefault: true });
  }

  // OAuth tokens on disk
  if (existsSync(TOKEN_DIR)) {
    const { readdirSync } = require('node:fs');
    for (const file of readdirSync(TOKEN_DIR) as string[]) {
      if (!file.endsWith('.json')) continue;
      const email = file.replace(/\.json$/, '');
      const existing = accounts.find(a => a.email === email);
      if (existing) {
        existing.authMethod = 'service-account'; // SA takes priority but OAuth exists too
      } else {
        accounts.push({ email, authMethod: 'oauth', isDefault: email === defaultEmail });
      }
    }
  }

  return accounts;
}

// ── Main token resolver ─────────────────────────────────────────────────────

export async function getAccessToken(userEmail?: string): Promise<string> {
  const email = resolveUserEmail(userEmail);
  const cached = tokenCache.get(email);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  // Try service account first (Workspace domains)
  const saValue = process.env.GOOGLE_SERVICE_ACCOUNT?.trim();
  if (saValue) {
    try {
      const sa = loadServiceAccount(saValue);
      const token = await JwtHelper.generateOAuth(sa, GMAIL_SCOPE, { sub: email });
      tokenCache.set(email, { token, expiresAt: Date.now() + 50 * 60 * 1000 });
      return token;
    } catch (err: any) {
      // If service account fails (e.g. personal Gmail), fall through to OAuth
      if (!loadOAuthToken(email)) throw err;
    }
  }

  // Fall back to OAuth2 refresh token
  const stored = loadOAuthToken(email);
  if (stored && Date.now() < stored.expires_at) {
    tokenCache.set(email, { token: stored.access_token, expiresAt: stored.expires_at });
    return stored.access_token;
  }

  if (stored?.refresh_token) {
    const token = await refreshOAuthAccessToken(email);
    tokenCache.set(email, { token, expiresAt: Date.now() + 55 * 60 * 1000 });
    return token;
  }

  throw new Error(`No auth for ${email}. For Workspace: set GOOGLE_SERVICE_ACCOUNT. For personal Gmail: run --auth ${email}`);
}
