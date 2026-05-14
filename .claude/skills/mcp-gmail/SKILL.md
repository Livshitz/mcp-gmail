---
name: mcp-gmail
description: >-
  Gmail API MCP server — read, search, compose, send, reply, draft, manage labels.
  Supports multiple accounts via user_email param (domain-wide delegation).
when_to_use: >-
  mcp-gmail, Gmail, email, send email, read email, compose, reply, draft, labels,
  GMAIL_USER_EMAIL, user_email, multi-account
paths: "src/**/*.ts,package.json"
---

# mcp-gmail

## Architecture
- **Entry**: `src/mcp/cli.ts` — `--stdio` (default) or `--http` (port 3461)
- **App factory**: `createGmailMcp()` in `src/app.ts`
- **API**: `gmailApi()` in `src/gmail-api.ts` — fetch-based, no SDK
- **Auth**: Service account + domain-wide delegation via `src/auth.ts`. Per-user token cache.
- **Large JSON**: `inlineOrSpool()` over threshold (default 12_000 chars)

## Multi-account
All tools accept an optional `user_email` param. If omitted, defaults to `GMAIL_USER_EMAIL`.
All users must be in the same Google Workspace domain with delegation authorized for the service account.

## MCP tool names
- `get_gmail_labels` — list all labels
- `get_gmail_messages` — list/search messages (q, labelIds, maxResults, pageToken)
- `get_gmail_message_by_id` — full message with parsed body + attachments
- `get_gmail_threads` — list threads
- `get_gmail_thread_by_id` — full thread with all messages
- `post_gmail_send` — compose and send (to, subject, body, cc, bcc, html)
- `post_gmail_reply` — reply-all to thread (threadId, messageId, body). Auto-includes To/CC participants; override with explicit to/cc
- `post_gmail_draft` — create draft
- `post_gmail_labels` — add/remove labels from a message

## Best practices
1. Use `q` param with Gmail search syntax: `from:alice is:unread newer_than:1d`
2. `get_gmail_messages` returns slim list — use `get_gmail_message_by_id` for full content
3. For replies, pass both `threadId` and `messageId` — headers are auto-set
4. `full=true` on any GET returns raw Gmail API payload (may spool to disk)
5. Labels use IDs not names (INBOX, SENT, UNREAD, or custom label IDs)
6. For multi-account: pass `user_email` on each call, or set `GMAIL_USER_EMAIL` as default

## Auth
- **Workspace**: `GOOGLE_SERVICE_ACCOUNT` (service account + domain-wide delegation)
- **Personal Gmail**: `GMAIL_OAUTH_CREDENTIALS` (OAuth2 — run `--auth <email>` once to store refresh token)
- Both work simultaneously; service account tried first, falls back to OAuth
- `GMAIL_USER_EMAIL` — default account (optional if user_email is always passed)
