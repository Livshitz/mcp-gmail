#!/usr/bin/env bun
import { createGmailMcp } from '../app.ts';
import { runAuthFlow } from '../auth.ts';

const argv = process.argv.slice(2);

// --auth <email> : interactive OAuth2 flow
const authIdx = argv.indexOf('--auth');
if (authIdx >= 0) {
  const email = argv[authIdx + 1];
  if (!email) { console.error('Usage: --auth <email>'); process.exit(1); }
  await runAuthFlow(email);
  process.exit(0);
}

const isStdio = argv.includes('--stdio');
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
