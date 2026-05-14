#!/usr/bin/env bun
import { createGmailMcp } from '../app.ts';
import { runAuthFlow, listAccounts } from '../auth.ts';
import { refreshAccount, type AccountCache } from '../cache.ts';

const argv = process.argv.slice(2);

// --auth <email> : interactive OAuth2 flow
const authIdx = argv.indexOf('--auth');
if (authIdx >= 0) {
  const email = argv[authIdx + 1];
  if (!email) { console.error('Usage: --auth <email>'); process.exit(1); }
  await runAuthFlow(email);
  process.exit(0);
}

// --list / --dashboard : show accounts + stats
if (argv.includes('--list') || argv.includes('--dashboard')) {
  await showDashboard();
  process.exit(0);
}

const isStdio = argv.includes('--stdio');
const isHttp = argv.includes('--http');

if (!isStdio && !isHttp) {
  // Default: show dashboard
  await showDashboard();
  process.exit(0);
}

const portIdx = argv.indexOf('--port');
const port = portIdx >= 0 ? parseInt(argv[portIdx + 1] ?? '3461', 10) || 3461 : 3461;

const { mcp, httpFetch } = createGmailMcp();

if (isStdio) {
  await mcp.serveStdio();
} else {
  const server = Bun.serve({ port, fetch: httpFetch });
  console.error(`[mcp-gmail] http+mcp listening on http://127.0.0.1:${server.port}`);
  console.error(`[mcp-gmail] MCP JSON-RPC: POST http://127.0.0.1:${server.port}/mcp`);
  console.error(`[mcp-gmail] REST: GET /health, /gmail/messages, …`);
}

// ── Dashboard ──────────────────────────────────────────────────────────────

async function showDashboard() {
  const accounts = listAccounts();
  if (!accounts.length) {
    console.log('No accounts configured. Run: --auth <email>');
    return;
  }

  console.log('\n📬 mcp-gmail dashboard\n');

  // ── Accounts table ──
  const stats: (AccountCache | null)[] = await Promise.all(
    accounts.map(async (a) => {
      try { return await refreshAccount(a.email); }
      catch { return null; }
    }),
  );

  const acctRows = accounts.map((a, i) => {
    const s = stats[i];
    return {
      Email: a.email,
      Auth: a.authMethod === 'service-account' ? 'SA' : 'OAuth',
      Default: a.isDefault ? '✓' : '',
      Unread: s ? String(s.unreadCount) : '?',
      Inbox: s ? String(s.inboxCount) : '?',
    };
  });

  printTable(acctRows);

  // ── Recent emails across all accounts ──
  const allRecent: { account: string; msg: AccountCache['recentMessages'][0] }[] = [];
  for (let i = 0; i < accounts.length; i++) {
    const s = stats[i];
    if (!s) continue;
    for (const msg of s.recentMessages) {
      allRecent.push({ account: accounts[i].email, msg });
    }
  }

  allRecent.sort((a, b) => Number(b.msg.internalDate) - Number(a.msg.internalDate));
  const top = allRecent.slice(0, 25);

  if (top.length > 0) {
    console.log('\nRecent emails:\n');
    const rows = top.map(({ account, msg }) => {
      const unread = msg.labelIds.includes('UNREAD') ? '●' : ' ';
      const from = shortAddr(msg.from);
      const date = relativeDate(msg.internalDate);
      const acct = accounts.length > 1 ? shortEmail(account) : '';
      return {
        ' ': unread,
        From: from.slice(0, 28),
        Subject: msg.subject.slice(0, 50),
        Date: date,
        ...(acct ? { Account: acct } : {}),
      };
    });
    printTable(rows);
  }

  console.log(`\nRefreshed: ${new Date().toLocaleTimeString()}\n`);
}

function shortAddr(addr: string): string {
  const match = addr.match(/^"?([^"<]+)"?\s*</);
  return match ? match[1].trim() : addr.split('@')[0];
}

function shortEmail(email: string): string {
  return email.split('@')[0];
}

function relativeDate(internalDate: string): string {
  const ms = Number(internalDate);
  if (!ms) return '?';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`;
  if (diff < 604800_000) return `${Math.floor(diff / 86400_000)}d`;
  return new Date(ms).toLocaleDateString();
}

function printTable(rows: Record<string, string>[]) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const widths = keys.map(k => Math.max(k.length, ...rows.map(r => (r[k] ?? '').length)));

  const header = keys.map((k, i) => k.padEnd(widths[i])).join('  ');
  const sep = widths.map(w => '─'.repeat(w)).join('──');
  console.log(`  ${header}`);
  console.log(`  ${sep}`);
  for (const row of rows) {
    const line = keys.map((k, i) => (row[k] ?? '').padEnd(widths[i])).join('  ');
    console.log(`  ${line}`);
  }
}
