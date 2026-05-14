import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JwtHelper } from 'edge.libx.js/build/helpers/jwt.js';

const GMAIL_SCOPE = 'https://mail.google.com/';

let cachedToken: { token: string; expiresAt: number } | null = null;

export function loadServiceAccount(value: string): any {
  if (value.trim().startsWith('{')) return JSON.parse(value);
  const filePath = resolve(process.cwd(), value);
  if (!existsSync(filePath)) throw new Error(`Service account file not found: ${filePath}`);
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

export function requireConfig() {
  const saValue = process.env.GOOGLE_SERVICE_ACCOUNT?.trim();
  if (!saValue) throw new Error('GOOGLE_SERVICE_ACCOUNT is not set');
  const userEmail = process.env.GMAIL_USER_EMAIL?.trim();
  if (!userEmail) throw new Error('GMAIL_USER_EMAIL is not set (e.g. agent@7chairs.org)');
  return { saValue, userEmail };
}

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;

  const { saValue, userEmail } = requireConfig();
  const sa = loadServiceAccount(saValue);
  const token = await JwtHelper.generateOAuth(sa, GMAIL_SCOPE, { sub: userEmail });
  cachedToken = { token, expiresAt: Date.now() + 50 * 60 * 1000 };
  return token;
}
