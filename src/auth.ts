import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JwtHelper } from 'edge.libx.js/build/helpers/jwt.js';

const GMAIL_SCOPE = 'https://mail.google.com/';

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

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

export async function getAccessToken(userEmail?: string): Promise<string> {
  const email = resolveUserEmail(userEmail);
  const cached = tokenCache.get(email);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const saValue = process.env.GOOGLE_SERVICE_ACCOUNT?.trim();
  if (!saValue) throw new Error('GOOGLE_SERVICE_ACCOUNT is not set');

  const sa = loadServiceAccount(saValue);
  const token = await JwtHelper.generateOAuth(sa, GMAIL_SCOPE, { sub: email });
  tokenCache.set(email, { token, expiresAt: Date.now() + 50 * 60 * 1000 });
  return token;
}
