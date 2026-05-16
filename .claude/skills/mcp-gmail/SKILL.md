---
name: mcp-gmail
description: >-
  Gmail API MCP server — read, search, compose, send, reply, draft, manage labels.
  Multi-account (service account + OAuth). Smart cache with dashboard CLI.
when_to_use: >-
  mcp-gmail, Gmail, email, send email, read email, compose, reply, draft, labels,
  GMAIL_USER_EMAIL, user_email, multi-account, dashboard
paths: "src/**/*.ts,package.json"
---

# mcp-gmail

## Architecture
- **Entry**: `src/mcp/cli.ts` — default=dashboard, `--stdio` or `--http` (port 3461)
- **App factory**: `createGmailMcp()` in `src/app.ts`
- **API**: `gmailApi()` in `src/gmail-api.ts` — fetch-based, no SDK
- **Auth**: `src/auth.ts` — service account (Workspace) + OAuth2 (personal Gmail). Per-user token cache.
- **Cache**: `src/cache.ts` — per-account stats (2-min TTL) + immutable message metadata (5000-cap LRU)
- **Large JSON**: `inlineOrSpool()` over threshold (default 12_000 chars)

## Multi-account
All tools accept an optional `user_email` param. If omitted, defaults to `GMAIL_USER_EMAIL`.
Workspace users need domain-wide delegation. Personal Gmail uses OAuth2 (`--auth <email>`).

## CLI
- `bun run src/mcp/cli.ts` — dashboard (default, no flags)
- `bun run src/mcp/cli.ts --dashboard` / `--list` — explicit dashboard
- `bun run src/mcp/cli.ts --auth <email>` — interactive OAuth2 flow
- `bun run src/mcp/cli.ts --stdio` — MCP stdio server
- `bun run src/mcp/cli.ts --http` — HTTP + MCP server (port 3461)

## MCP tool names
- `get_gmail_accounts` — list accounts with unread/inbox counts, recent subjects (call first for overview)
- `get_gmail_labels` — list all labels
- `get_gmail_messages` — list/search messages (q, labelIds, maxResults, pageToken). Uses cache for metadata.
- `get_gmail_message_by_id` — full message with parsed body + attachments
- `get_gmail_threads` — list threads
- `get_gmail_thread_by_id` — full thread with all messages
- `post_gmail_send` — compose and send (to, subject, body, cc, bcc, html)
- `post_gmail_reply` — reply-all to thread (threadId, messageId, body). Auto-includes To/CC participants; override with explicit to/cc
- `post_gmail_draft` — create draft
- `post_gmail_batch_modify` — bulk add/remove labels by search query (e.g. mark all unread as read in one call)
- `post_gmail_labels` — add/remove labels from a single message

## Best practices
1. Call `get_gmail_accounts` first for a quick overview of all accounts + unread counts
2. Use `q` param with Gmail search syntax: `from:alice is:unread newer_than:1d`
3. `get_gmail_messages` returns cached slim list — use `get_gmail_message_by_id` for full content
4. For replies, pass both `threadId` and `messageId` — headers are auto-set
5. `full=true` on any GET returns raw Gmail API payload (may spool to disk)
6. For bulk label changes, use `post_gmail_batch_modify` with a query (e.g. `q: "is:unread"`) — one call instead of per-message
7. Labels use IDs not names (INBOX, SENT, UNREAD, or custom label IDs)
7. For multi-account: pass `user_email` on each call, or set `GMAIL_USER_EMAIL` as default

## Auth
- **Workspace**: `GOOGLE_SERVICE_ACCOUNT` (service account + domain-wide delegation)
- **Personal Gmail**: `GMAIL_OAUTH_CREDENTIALS` or `GMAIL_OAUTH_CLIENT_ID` + `GMAIL_OAUTH_CLIENT_SECRET` (run `--auth <email>` once to store refresh token)
- Both work simultaneously; service account tried first, falls back to OAuth
- `GMAIL_USER_EMAIL` — default account (optional if user_email is always passed)
