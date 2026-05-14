import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { gmailApi } from './gmail-api.ts';

const CACHE_DIR = join(homedir(), '.mcp-gmail', 'cache');

interface CachedMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  labelIds: string[];
  internalDate: string;
}

interface AccountCache {
  email: string;
  unreadCount: number;
  inboxCount: number;
  recentMessages: CachedMessage[];
  unreadMessages: CachedMessage[];
  lastRefreshed: number;
}

interface CacheStore {
  accounts: Record<string, AccountCache>;
  messages: Record<string, CachedMessage>; // id -> message metadata (immutable)
}

const LIST_TTL = 2 * 60 * 1000; // 2 min for list queries
const MSG_TTL = Infinity; // message metadata is immutable

let store: CacheStore = { accounts: {}, messages: {} };
let loaded = false;

function cachePath(): string {
  return join(CACHE_DIR, 'gmail-cache.json');
}

function loadStore(): void {
  if (loaded) return;
  try {
    const p = cachePath();
    if (existsSync(p)) store = JSON.parse(readFileSync(p, 'utf-8'));
  } catch { /* start fresh */ }
  loaded = true;
}

function saveStore(): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath(), JSON.stringify(store, null, 2));
}

function extractHeaders(msg: any): CachedMessage {
  const headers = msg.payload?.headers ?? [];
  const h = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
  return {
    id: msg.id,
    threadId: msg.threadId,
    from: h('From'),
    to: h('To'),
    subject: h('Subject'),
    date: h('Date'),
    snippet: msg.snippet ?? '',
    labelIds: msg.labelIds ?? [],
    internalDate: msg.internalDate ?? '',
  };
}

async function fetchMessageMeta(ids: { id: string }[], userEmail: string): Promise<CachedMessage[]> {
  loadStore();
  const result: CachedMessage[] = [];
  const toFetch: string[] = [];

  for (const { id } of ids) {
    if (store.messages[id]) {
      result.push(store.messages[id]);
    } else {
      toFetch.push(id);
    }
  }

  if (toFetch.length > 0) {
    const batch = await Promise.all(
      toFetch.map(id => gmailApi(`messages/${id}`, {
        query: { format: 'metadata' },
        userEmail,
      })),
    );
    for (const msg of batch) {
      const cached = extractHeaders(msg);
      store.messages[cached.id] = cached;
      result.push(cached);
    }
    saveStore();
  }

  // Maintain original order
  const orderMap = new Map(ids.map(({ id }, i) => [id, i]));
  result.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
  return result;
}

export async function refreshAccount(email: string, force = false): Promise<AccountCache> {
  loadStore();
  const existing = store.accounts[email];
  if (!force && existing && Date.now() - existing.lastRefreshed < LIST_TTL) return existing;

  const [inboxList, inboxLabel] = await Promise.all([
    gmailApi<{ messages?: { id: string }[]; resultSizeEstimate?: number }>('messages', {
      query: { maxResults: '20', labelIds: 'INBOX' },
      userEmail: email,
    }),
    gmailApi<{ messagesTotal?: number; messagesUnread?: number; threadsTotal?: number; threadsUnread?: number }>('labels/INBOX', {
      userEmail: email,
    }),
  ]);

  const inboxIds = inboxList.messages ?? [];
  const allMeta = await fetchMessageMeta(inboxIds, email);
  const metaMap = new Map(allMeta.map(m => [m.id, m]));

  const recentMessages = inboxIds.map(({ id }) => metaMap.get(id)!).filter(Boolean);
  const unreadMessages = recentMessages.filter(m => m.labelIds.includes('UNREAD'));

  const account: AccountCache = {
    email,
    unreadCount: inboxLabel.messagesUnread ?? unreadMessages.length,
    inboxCount: inboxLabel.messagesTotal ?? recentMessages.length,
    recentMessages,
    unreadMessages,
    lastRefreshed: Date.now(),
  };

  store.accounts[email] = account;
  saveStore();
  return account;
}

export function getCachedAccount(email: string): AccountCache | null {
  loadStore();
  return store.accounts[email] ?? null;
}

export function getCachedMessage(id: string): CachedMessage | null {
  loadStore();
  return store.messages[id] ?? null;
}

export function cacheMessage(msg: any): CachedMessage {
  loadStore();
  const cached = extractHeaders(msg);
  store.messages[cached.id] = cached;
  saveStore();
  return cached;
}

export type { CachedMessage, AccountCache };
