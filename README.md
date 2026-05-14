# mcp-gmail

Gmail API MCP server using service account + domain-wide delegation. No OAuth consent flow — impersonates any Google Workspace user directly.

## Setup

### 1. GCP Project

1. [Enable Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com) in your GCP project
2. Create a service account (or reuse an existing one, e.g. shared with Google Drive)
3. Download the service account JSON key

### 2. Domain-Wide Delegation

1. Go to [Google Workspace Admin](https://admin.google.com) → Security → API Controls → **Domain-wide Delegation**
2. Click **Add new** and enter:
   - **Client ID**: your service account's client ID (numeric, from the JSON `client_id` field)
   - **Scopes**: `https://mail.google.com/`
3. Authorize

### 3. Environment

```bash
# Path to JSON key file, or inline JSON string
export GOOGLE_SERVICE_ACCOUNT=./secrets/google-service-account.json

# Default Workspace user to impersonate (optional if user_email is always passed per-call)
export GMAIL_USER_EMAIL=agent@yourdomain.com
```

Optional:
- `MCP_GMAIL_SPOOL_THRESHOLD` — char limit before spooling to disk (default 12000)
- `MCP_GMAIL_CACHE_DIR` — spool directory (default `.mcp-gmail/cache/`)

### 4. Run

```bash
bun install

# MCP stdio mode (for Claude Code / Unclaw)
bun run src/mcp/cli.ts --stdio

# HTTP mode (for testing / direct API)
bun run src/mcp/cli.ts --http --port 3461
```

## Tools

| Tool | Method | Description |
|------|--------|-------------|
| `get_gmail_labels` | GET | List all labels |
| `get_gmail_messages` | GET | Search/list messages (`q`, `labelIds`, `maxResults`, `pageToken`) |
| `get_gmail_message_by_id` | GET | Full message with parsed body + attachments |
| `get_gmail_threads` | GET | List threads |
| `get_gmail_thread_by_id` | GET | Full thread with all messages |
| `post_gmail_send` | POST | Compose and send (`to`, `subject`, `body`, `cc`, `bcc`, `html`) |
| `post_gmail_reply` | POST | Reply-all to thread (`threadId`, `messageId`, `body`). Auto-includes all To/CC participants. Override with explicit `to`/`cc`. |
| `post_gmail_draft` | POST | Create draft |
| `post_gmail_labels` | POST | Add/remove labels from a message |

## Multi-account

All tools accept an optional `user_email` parameter. One MCP instance can serve multiple Gmail accounts in the same Workspace domain — no need to run separate instances.

```
# Read elya's inbox
get_gmail_messages(user_email: "elya.l@7chairs.org", q: "is:unread")

# Send as agent
post_gmail_send(user_email: "agent@7chairs.org", to: "...", subject: "...", body: "...")
```

If `user_email` is omitted, falls back to `GMAIL_USER_EMAIL`. All target users must be in the same Google Workspace domain with the service account's delegation scope authorized.

## Search syntax

The `q` parameter uses [Gmail search syntax](https://support.google.com/mail/answer/7190):

```
from:alice is:unread newer_than:1d
subject:invoice has:attachment
to:me after:2026/01/01
```

## Auth note

Requires `edge.libx.js` ≥0.5.4 — the `JwtHelper.generateOAuth` method needs `options.sub` support to set the JWT `sub` claim for domain-wide delegation (impersonating a user different from the service account).
