#!/usr/bin/env bun
import { createGmailMcp } from '../app.ts';

const argv = process.argv.slice(2);
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
