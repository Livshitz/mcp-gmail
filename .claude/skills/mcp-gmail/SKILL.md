---
name: mcp-gmail
description: >-
  Gmail API MCP server — read, search, compose, send, reply, draft, manage labels
  for agent@7chairs.org via service account delegation.
when_to_use: >-
  mcp-gmail, Gmail, email, send email, read email, compose, reply, draft, labels,
  GMAIL_USER_EMAIL, agent@7chairs.org
paths: "src/**/*.ts,package.json"
---

# mcp-gmail

## Architecture
- **Entry**: `src/mcp/cli.ts` — `--stdio` (default) or `--http` (port 3461)
- **App factory**: `createGmailMcp()` in `src/app.ts`
- **API**: `gmailApi()` in `src/gmail-api.ts` — fetch-based, no SDK
- **Auth**: Service account + domain-wide delegation via `src/auth.ts`
- **Large JSON**: `inlineOrSpool()` over threshold (default 12_000 chars)

## MCP tool names
- `get_gmail_labels` — list all labels
- `get_gmail_messages` — list/search messages (q, labelIds, maxResults, pageToken)
- `get_gmail_message_by_id` — full message with parsed body + attachments
- `get_gmail_threads` — list threads
- `get_gmail_thread_by_id` — full thread with all messages
- `post_gmail_send` — compose and send (to, subject, body, cc, bcc, html)
- `post_gmail_reply` — reply to thread (threadId, messageId, body)
- `post_gmail_draft` — create draft
- `post_gmail_labels` — add/remove labels from a message

## Best practices
1. Use `q` param with Gmail search syntax: `from:alice is:unread newer_than:1d`
2. `get_gmail_messages` returns slim list — use `get_gmail_message_by_id` for full content
3. For replies, pass both `threadId` and `messageId` — headers are auto-set
4. `full=true` on any GET returns raw Gmail API payload (may spool to disk)
5. Labels use IDs not names (INBOX, SENT, UNREAD, or custom label IDs)

## Environment
- `GOOGLE_SERVICE_ACCOUNT` — path or inline JSON (shared with mcp-google-drive)
- `GMAIL_USER_EMAIL` — impersonated user (e.g. `agent@7chairs.org`)
