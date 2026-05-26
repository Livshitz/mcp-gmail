import { resolve } from 'node:path';
import { json } from 'itty-router';
import { RouterWrapper } from 'edge.libx.js/build/main.js';
import { augmentMcpWithSkillResource } from './mcp/with-skill-resource.ts';
import { gmailApi } from './gmail-api.ts';
import { resolveUserEmail, getDefaultUserEmail, listAccounts } from './auth.ts';
import { parseMessage } from './parse.ts';
import { buildRawMessage, escapeHtml } from './mime.ts';
import { slimThread } from './slim.ts';
import { inlineOrSpool } from './spool.ts';
import { refreshAccount, cacheMessage, fetchMessageMetaCached } from './cache.ts';

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function qp(req: { url: string; query?: Record<string, unknown> }, key: string): string | undefined {
  const q = req.query?.[key];
  if (q !== undefined && q !== null && String(q) !== '') return String(q);
  try {
    return new URL(req.url, 'http://_').searchParams.get(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function truthyFull(req: { url: string; query?: Record<string, unknown> }): boolean {
  const v = qp(req, 'full');
  return v === 'true' || v === '1' || v === 'yes';
}

const USER_EMAIL_PARAM = { description: 'Email to act as (defaults to GMAIL_USER_EMAIL env var). For multi-account, pass the target email.', type: 'string' };

export function createGmailMcp() {
  const base = RouterWrapper.getNew('', {
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  });
  const { router } = base;

  // ── GET /gmail/accounts ──
  base.describeMCP('/gmail/accounts', 'GET', {
    description: 'List all configured Gmail accounts with stats (unread count, recent messages). Call this first to discover available accounts and their state.',
    params: {
      refresh: { description: 'Set to true to force-refresh stats from Gmail API (default: uses cache with 2min TTL)', type: 'string' },
    },
    annotations: { readOnlyHint: true },
  });
  router.get('/gmail/accounts', async (req) => {
    try {
      const force = qp(req, 'refresh') === 'true';
      const accounts = listAccounts();
      const enriched = await Promise.all(accounts.map(async (a) => {
        try {
          const stats = await refreshAccount(a.email, force);
          return {
            ...a,
            unreadCount: stats.unreadCount,
            inboxCount: stats.inboxCount,
            lastRefreshed: new Date(stats.lastRefreshed).toISOString(),
            recentSubjects: stats.recentMessages.slice(0, 5).map(m => ({
              id: m.id,
              from: m.from,
              subject: m.subject,
              date: m.date,
              unread: m.labelIds.includes('UNREAD'),
            })),
          };
        } catch (e) {
          return { ...a, error: errMessage(e) };
        }
      }));
      return json({ accounts: enriched });
    } catch (e) {
      return json({ error: errMessage(e) }, { status: 500 });
    }
  });

  // ── GET /gmail/labels ──
  base.describeMCP('/gmail/labels', 'GET', {
    description: 'List all Gmail labels (INBOX, SENT, custom labels, etc).',
    params: { user_email: USER_EMAIL_PARAM },
    annotations: { readOnlyHint: true },
  });
  router.get('/gmail/labels', async (req) => {
    try {
      const ue = qp(req, 'user_email');
      const data = await gmailApi('labels', { userEmail: ue });
      return json(inlineOrSpool('get_gmail_labels', data));
    } catch (e) {
      return json({ error: errMessage(e) }, { status: 500 });
    }
  });

  // ── GET /gmail/messages ──
  base.describeMCP('/gmail/messages', 'GET', {
    description:
      'List messages. Use q for Gmail search syntax (e.g. "from:alice subject:invoice is:unread"). Default 20, max 100. Returns slim list; use get_gmail_message_by_id for full content.',
    params: {
      q: { description: 'Gmail search query (same syntax as Gmail search bar)', type: 'string' },
      labelIds: { description: 'Comma-separated label IDs to filter (e.g. INBOX,UNREAD)', type: 'string' },
      maxResults: { description: 'Max messages to return (default 20, max 100)', type: 'string' },
      pageToken: { description: 'Pagination token from previous response', type: 'string' },
      full: { description: 'Set to true to include full message payloads (slower)', type: 'string' },
      user_email: USER_EMAIL_PARAM,
    },
    annotations: { readOnlyHint: true },
  });
  router.get('/gmail/messages', async (req) => {
    try {
      const ue = qp(req, 'user_email');
      const maxResults = Math.min(parseInt(qp(req, 'maxResults') ?? '20', 10) || 20, 100);
      const query: Record<string, string> = { maxResults: String(maxResults) };
      const q = qp(req, 'q');
      if (q) query.q = q;
      const labelIds = qp(req, 'labelIds');
      if (labelIds) query.labelIds = labelIds;
      const pageToken = qp(req, 'pageToken');
      if (pageToken) query.pageToken = pageToken;

      const list = await gmailApi<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string; resultSizeEstimate?: number }>('messages', { query, userEmail: ue });

      if (!list.messages?.length) return json({ messages: [], resultSizeEstimate: 0 });

      const full = truthyFull(req);
      if (!full) {
        const cached = await fetchMessageMetaCached(list.messages, ue);
        return json(inlineOrSpool('get_gmail_messages', {
          messages: cached,
          nextPageToken: list.nextPageToken,
          resultSizeEstimate: list.resultSizeEstimate,
        }));
      }

      const batch = await Promise.all(
        list.messages.map((m) => gmailApi(`messages/${m.id}`, { query: { format: 'full' }, userEmail: ue })),
      );
      return json(inlineOrSpool('get_gmail_messages', {
        messages: batch.map(parseMessage),
        nextPageToken: list.nextPageToken,
        resultSizeEstimate: list.resultSizeEstimate,
      }));
    } catch (e) {
      return json({ error: errMessage(e) }, { status: 500 });
    }
  });

  // ── GET /gmail/messages/:id ──
  base.describeMCP('/gmail/messages/:id', 'GET', {
    description: 'Get a single message by ID. Returns parsed headers, body text, HTML, and attachment metadata.',
    params: {
      id: { description: 'Message ID', type: 'string' },
      full: { description: 'Set to true for raw Gmail API payload', type: 'string' },
      user_email: USER_EMAIL_PARAM,
    },
    annotations: { readOnlyHint: true },
  });
  router.get('/gmail/messages/:id', async (req) => {
    try {
      const { id } = req.params ?? {};
      if (!id) return json({ error: 'id is required' }, { status: 400 });
      const ue = qp(req, 'user_email');
      const msg = await gmailApi(`messages/${id}`, { query: { format: 'full' }, userEmail: ue });
      cacheMessage(msg);
      const out = truthyFull(req) ? msg : parseMessage(msg);
      return json(inlineOrSpool('get_gmail_message_by_id', out));
    } catch (e) {
      return json({ error: errMessage(e) }, { status: 500 });
    }
  });

  // ── GET /gmail/threads ──
  base.describeMCP('/gmail/threads', 'GET', {
    description: 'List threads. Same search params as messages.',
    params: {
      q: { description: 'Gmail search query', type: 'string' },
      labelIds: { description: 'Comma-separated label IDs', type: 'string' },
      maxResults: { description: 'Max threads (default 20, max 100)', type: 'string' },
      pageToken: { description: 'Pagination token', type: 'string' },
      user_email: USER_EMAIL_PARAM,
    },
    annotations: { readOnlyHint: true },
  });
  router.get('/gmail/threads', async (req) => {
    try {
      const ue = qp(req, 'user_email');
      const maxResults = Math.min(parseInt(qp(req, 'maxResults') ?? '20', 10) || 20, 100);
      const query: Record<string, string> = { maxResults: String(maxResults) };
      const q = qp(req, 'q');
      if (q) query.q = q;
      const labelIds = qp(req, 'labelIds');
      if (labelIds) query.labelIds = labelIds;
      const pageToken = qp(req, 'pageToken');
      if (pageToken) query.pageToken = pageToken;

      const data = await gmailApi('threads', { query, userEmail: ue });
      return json(inlineOrSpool('get_gmail_threads', data));
    } catch (e) {
      return json({ error: errMessage(e) }, { status: 500 });
    }
  });

  // ── GET /gmail/threads/:id ──
  base.describeMCP('/gmail/threads/:id', 'GET', {
    description: 'Get a full thread with all messages. Returns parsed messages by default.',
    params: {
      id: { description: 'Thread ID', type: 'string' },
      full: { description: 'Set to true for raw Gmail API payload', type: 'string' },
      user_email: USER_EMAIL_PARAM,
    },
    annotations: { readOnlyHint: true },
  });
  router.get('/gmail/threads/:id', async (req) => {
    try {
      const { id } = req.params ?? {};
      if (!id) return json({ error: 'id is required' }, { status: 400 });
      const ue = qp(req, 'user_email');
      const thread = await gmailApi(`threads/${id}`, { query: { format: 'full' }, userEmail: ue });
      const out = truthyFull(req) ? thread : slimThread(thread);
      return json(inlineOrSpool('get_gmail_thread_by_id', out));
    } catch (e) {
      return json({ error: errMessage(e) }, { status: 500 });
    }
  });

  // ── POST /gmail/send ──
  base.describeMCP('/gmail/send', 'POST', {
    description:
      'Compose and send an email. Supports file attachments via local file paths. Body: { to, subject, body, cc?, bcc?, html?, user_email?, threadId?, inReplyTo?, attachments?: [{path, filename?, mimeType?}] }. Sends from user_email or GMAIL_USER_EMAIL. Set threadId + inReplyTo to keep the message in an existing thread.',
    params: {
      body: {
        description: '{ to: string, subject: string, body: string, cc?: string, bcc?: string, html?: string, user_email?: string, threadId?: string, inReplyTo?: string, attachments?: Array<{path: string, filename?: string, mimeType?: string}> }',
        type: 'object',
      },
    },
    annotations: { destructiveHint: false },
  });
  router.post('/gmail/send', async (req) => {
    try {
      const data = (await req.json()) as Record<string, string>;
      if (!data.to || !data.subject || !data.body)
        return json({ error: 'to, subject, and body are required' }, { status: 400 });

      const from = resolveUserEmail(data.user_email);
      const raw = buildRawMessage({ from, to: data.to, cc: data.cc, bcc: data.bcc, subject: data.subject, body: data.body, html: data.html, inReplyTo: data.inReplyTo, references: data.inReplyTo, attachments: data.attachments });
      const sendBody: Record<string, string> = { raw };
      if (data.threadId) sendBody.threadId = data.threadId;
      const result = await gmailApi('messages/send', { method: 'POST', body: sendBody, userEmail: from });
      return json({ ok: true, id: result.id, threadId: result.threadId });
    } catch (e) {
      return json({ error: errMessage(e) }, { status: 500 });
    }
  });

  // ── POST /gmail/reply ──
  base.describeMCP('/gmail/reply', 'POST', {
    description:
      'Reply-all to an existing thread. Supports file attachments. Auto-includes all original To/CC participants (excluding self). Override with explicit to/cc/bcc. Auto-quotes original message (disable with quoteOriginal: false). Body: { threadId, messageId, body, html?, to?, cc?, bcc?, user_email?, quoteOriginal?, attachments?: [{path, filename?, mimeType?}] }.',
    params: {
      body: {
        description: '{ threadId: string, messageId: string, body: string, html?: string, to?: string, cc?: string, bcc?: string, user_email?: string, quoteOriginal?: boolean, attachments?: Array<{path: string, filename?: string, mimeType?: string}> }',
        type: 'object',
      },
    },
    annotations: { destructiveHint: false },
  });
  router.post('/gmail/reply', async (req) => {
    try {
      const data = (await req.json()) as Record<string, string>;
      if (!data.threadId || !data.messageId || !data.body)
        return json({ error: 'threadId, messageId, and body are required' }, { status: 400 });

      const from = resolveUserEmail(data.user_email);
      const orig = await gmailApi(`messages/${data.messageId}`, { query: { format: 'full' }, userEmail: from });
      const headers = orig.payload?.headers ?? [];
      const h = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

      const selfLower = from.toLowerCase();
      const filterSelf = (addrs: string) => addrs.split(',').map(a => a.trim()).filter(a => !a.toLowerCase().includes(selfLower)).join(', ');

      const replyTo = data.to || [h('From'), filterSelf(h('To'))].filter(Boolean).join(', ');
      const replyCc = data.cc ?? filterSelf(h('Cc'));

      const subject = h('Subject').startsWith('Re:') ? h('Subject') : `Re: ${h('Subject')}`;

      let plainBody = data.body;
      let htmlBody = data.html;
      const shouldQuote = data.quoteOriginal !== 'false' && data.quoteOriginal !== false;
      if (shouldQuote) {
        const parsed = parseMessage(orig);
        if (parsed.body) {
          const origFrom = h('From');
          const origDate = h('Date');
          const quotedLines = parsed.body.split('\n').map((l: string) => `> ${l}`).join('\n');
          plainBody += `\n\nOn ${origDate}, ${origFrom} wrote:\n${quotedLines}`;
          const quotedHtml = parsed.html || escapeHtml(parsed.body).replace(/\n/g, '<br>');
          const safeFrom = escapeHtml(origFrom);
          const safeDate = escapeHtml(origDate);
          const quoteBlock = `<br><br><div class="gmail_quote"><div style="color:#888;margin-bottom:4px">On ${safeDate}, ${safeFrom} wrote:</div><blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${quotedHtml}</blockquote></div>`;
          if (htmlBody) {
            htmlBody += quoteBlock;
          } else {
            const newHtml = escapeHtml(data.body).replace(/\n/g, '<br>');
            htmlBody = `<div style="font-family:sans-serif;font-size:14px">${newHtml}</div>` + quoteBlock;
          }
        }
      }

      const raw = buildRawMessage({
        from,
        to: replyTo,
        cc: replyCc || undefined,
        bcc: data.bcc,
        subject,
        body: plainBody,
        html: htmlBody,
        inReplyTo: h('Message-ID'),
        references: h('Message-ID'),
        attachments: data.attachments,
      });
      const result = await gmailApi('messages/send', { method: 'POST', body: { raw, threadId: data.threadId }, userEmail: from });
      return json({ ok: true, id: result.id, threadId: result.threadId });
    } catch (e) {
      return json({ error: errMessage(e) }, { status: 500 });
    }
  });

  // ── POST /gmail/drafts ──
  base.describeMCP('/gmail/drafts', 'POST', {
    description: 'Create a draft email. Supports file attachments. Body: { to, subject, body, cc?, bcc?, html?, user_email?, attachments?: [{path, filename?, mimeType?}] }.',
    params: {
      body: {
        description: '{ to: string, subject: string, body: string, cc?: string, bcc?: string, html?: string, user_email?: string, attachments?: Array<{path: string, filename?: string, mimeType?: string}> }',
        type: 'object',
      },
    },
    annotations: { destructiveHint: false },
  });
  router.post('/gmail/drafts', async (req) => {
    try {
      const data = (await req.json()) as Record<string, string>;
      if (!data.to || !data.subject || !data.body)
        return json({ error: 'to, subject, and body are required' }, { status: 400 });

      const from = resolveUserEmail(data.user_email);
      const raw = buildRawMessage({ from, to: data.to, cc: data.cc, bcc: data.bcc, subject: data.subject, body: data.body, html: data.html, attachments: data.attachments });
      const result = await gmailApi('drafts', { method: 'POST', body: { message: { raw } }, userEmail: from });
      return json({ ok: true, id: result.id, message: result.message });
    } catch (e) {
      return json({ error: errMessage(e) }, { status: 500 });
    }
  });

  // ── POST /gmail/batch-modify ──
  base.describeMCP('/gmail/batch-modify', 'POST', {
    description:
      'Batch add/remove labels on messages matching a Gmail search query. Use for bulk operations like "mark all unread as read". ' +
      'Body: { q: string, addLabelIds?: string[], removeLabelIds?: string[], user_email?: string }. ' +
      'Fetches up to 500 matching message IDs and modifies in one API call. Returns count of modified messages.',
    params: {
      body: {
        description: '{ q: string, addLabelIds?: string[], removeLabelIds?: string[], user_email?: string }',
        type: 'object',
      },
    },
    annotations: { destructiveHint: false },
  });
  router.post('/gmail/batch-modify', async (req) => {
    try {
      const data = (await req.json()) as Record<string, any>;
      if (!data.q) return json({ error: 'q (search query) is required' }, { status: 400 });
      if (!data.addLabelIds?.length && !data.removeLabelIds?.length)
        return json({ error: 'at least one of addLabelIds or removeLabelIds is required' }, { status: 400 });

      const ue = data.user_email;
      const ids: string[] = [];
      let pageToken: string | undefined;

      do {
        const query: Record<string, string> = { q: data.q, maxResults: '500' };
        if (pageToken) query.pageToken = pageToken;
        const list = await gmailApi<{ messages?: { id: string }[]; nextPageToken?: string }>('messages', { query, userEmail: ue });
        if (list.messages) ids.push(...list.messages.map(m => m.id));
        pageToken = list.nextPageToken;
      } while (pageToken && ids.length < 1000);

      if (!ids.length) return json({ ok: true, modified: 0, message: 'No messages matched query' });

      await gmailApi('messages/batchModify', {
        method: 'POST',
        body: { ids, addLabelIds: data.addLabelIds, removeLabelIds: data.removeLabelIds },
        userEmail: ue,
      });

      return json({ ok: true, modified: ids.length });
    } catch (e) {
      return json({ error: errMessage(e) }, { status: 500 });
    }
  });

  // ── POST /gmail/messages/:id/labels ──
  base.describeMCP('/gmail/messages/:id/labels', 'POST', {
    description: 'Add or remove labels from a message. Body: { addLabelIds?: string[], removeLabelIds?: string[], user_email?: string }.',
    params: {
      id: { description: 'Message ID', type: 'string' },
      body: {
        description: '{ addLabelIds?: string[], removeLabelIds?: string[], user_email?: string }',
        type: 'object',
      },
    },
    annotations: { destructiveHint: false },
  });
  router.post('/gmail/messages/:id/labels', async (req) => {
    try {
      const { id } = req.params ?? {};
      if (!id) return json({ error: 'id is required' }, { status: 400 });
      const data = (await req.json()) as Record<string, any>;
      const ue = data.user_email;
      const result = await gmailApi(`messages/${id}/modify`, { method: 'POST', body: { addLabelIds: data.addLabelIds, removeLabelIds: data.removeLabelIds }, userEmail: ue });
      return json({ ok: true, id: result.id, labelIds: result.labelIds });
    } catch (e) {
      return json({ error: errMessage(e) }, { status: 500 });
    }
  });

  // ── GET /gmail/filters ──
  base.describeMCP('/gmail/filters', 'GET', {
    description: 'List all Gmail filters (rules) for the account. Query: { user_email? }',
    params: { user_email: { description: 'Account to act as (optional)', type: 'string' } },
    annotations: { readOnlyHint: true },
  });

  router.get('/gmail/filters', async (req) => {
    try {
      const ue = new URL(req.url).searchParams.get('user_email') ?? undefined;
      const result = await gmailApi<{ filter?: any[] }>('settings/filters', { userEmail: ue });
      return json(inlineOrSpool('filters', result.filter ?? []));
    } catch (e) {
      return json({ error: errMessage(e) }, { status: 500 });
    }
  });

  // ── POST /gmail/filters ──
  base.describeMCP('/gmail/filters', 'POST', {
    description:
      'Create a Gmail filter (rule). Body: { criteria: { from?, to?, subject?, query?, negatedQuery?, hasAttachment?, excludeChats?, size?, sizeComparison? }, action: { addLabelIds?, removeLabelIds?, forward? }, user_email? }. ' +
      'Use label IDs (e.g. "INBOX","UNREAD","TRASH","Label_123"), not display names. Common: removeLabelIds:["INBOX"] to archive, removeLabelIds:["UNREAD"] to mark read.',
    params: { body: { description: '{ criteria, action, user_email? }', type: 'object' } },
    annotations: { destructiveHint: false },
  });

  router.post('/gmail/filters', async (req) => {
    try {
      const data = (await req.json()) as Record<string, any>;
      const { criteria, action, user_email: ue } = data;
      if (!criteria || !Object.keys(criteria).length) return json({ error: 'criteria is required (at least one field)' }, { status: 400 });
      if (!action || !Object.keys(action).length) return json({ error: 'action is required (at least one field)' }, { status: 400 });
      const result = await gmailApi('settings/filters', { method: 'POST', body: { criteria, action }, userEmail: ue });
      return json({ ok: true, filter: result });
    } catch (e) {
      return json({ error: errMessage(e) }, { status: 500 });
    }
  });

  // ── POST /gmail/filters/delete ──
  base.describeMCP('/gmail/filters/delete', 'POST', {
    description: 'Delete a Gmail filter by ID. Body: { id, user_email? }. Get filter IDs from get_gmail_filters.',
    params: { body: { description: '{ id: string, user_email? }', type: 'object' } },
    annotations: { destructiveHint: true },
  });

  router.post('/gmail/filters/delete', async (req) => {
    try {
      const data = (await req.json()) as Record<string, any>;
      if (!data.id) return json({ error: 'id is required' }, { status: 400 });
      await gmailApi(`settings/filters/${data.id}`, { method: 'DELETE', userEmail: data.user_email });
      return json({ ok: true, deleted: data.id });
    } catch (e) {
      return json({ error: errMessage(e) }, { status: 500 });
    }
  });

  base.catchNotFound();

  const defaultEmail = getDefaultUserEmail();
  const mcp = base.asMCP({
    name: 'mcp-gmail',
    version: '0.4.0',
    instructions:
      `Gmail API MCP${defaultEmail ? ` (default: ${defaultEmail})` : ''}. Read, search, compose, send, reply, draft, manage labels, and manage filters (rules). ` +
      'Supports multiple accounts (Workspace + personal Gmail) — pass user_email to act as a different user. ' +
      'Start with get_gmail_accounts for a quick overview of all accounts, unread counts, and recent subjects. ' +
      'Use Gmail search syntax for q param (e.g. "from:alice is:unread newer_than:1d"). ' +
      'get_gmail_messages returns cached slim list — use get_gmail_message_by_id for full content. ' +
      'Replies auto-include all To/CC participants (reply-all). ' +
      'Use post_gmail_batch_modify for bulk label operations (e.g. mark all unread as read in one call). ' +
      'All tools spool large results to disk.',
  });

  augmentMcpWithSkillResource(mcp, {
    serverName: 'mcp-gmail',
    repoRootAbs: resolve(import.meta.dirname, '..'),
    skillRelativePath: '.claude/skills/mcp-gmail/SKILL.md',
  });

  async function httpFetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/health') return json({ ok: true, service: 'mcp-gmail' });
    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) return mcp.httpHandler(req);
    return base.fetchHandler(req);
  }

  return { mcp, httpFetch, base };
}
