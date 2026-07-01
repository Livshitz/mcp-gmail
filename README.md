# mcp-gmail

Gmail API MCP server. Supports **Google Workspace** (service account delegation) and **personal Gmail** (OAuth2 refresh token). One instance handles multiple accounts.

## Auth Methods

### Option A: Service Account (Workspace domains)

Best for orgs. No per-user consent flow — impersonates any user in the domain.

1. [Enable Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com) in your GCP project
2. Create a service account + download JSON key
3. [Google Workspace Admin](https://admin.google.com) → Security → API Controls → **Domain-wide Delegation** → add client ID with scope `https://mail.google.com/`

```bash
export GOOGLE_SERVICE_ACCOUNT=./secrets/google-service-account.json
export GMAIL_USER_EMAIL=agent@yourdomain.com  # default account
```

### Option B: OAuth2 (personal Gmail / external accounts)

For `@gmail.com` or any account you can't delegate via service account.

1. GCP Console → APIs & Services → Credentials → **Create OAuth client ID** (Desktop app)
2. Download as `client_secret.json`
3. Authenticate:

```bash
export GMAIL_OAUTH_CREDENTIALS=./client_secret.json

# One-time per email — opens browser for consent
bun run src/mcp/cli.ts --auth elya.livshitz@gmail.com
```

Tokens are stored in `~/.mcp-gmail/tokens/{email}.json` and auto-refresh.

You can also set `GMAIL_OAUTH_CLIENT_ID` + `GMAIL_OAUTH_CLIENT_SECRET` instead of a credentials file.

### Mixed mode

Both auth methods work simultaneously. Service account is tried first; if it fails (e.g. personal Gmail), falls back to stored OAuth token.

```bash
# Workspace accounts use service account delegation
get_gmail_messages(user_email: "agent@7chairs.org")

# Personal accounts use stored OAuth token
get_gmail_messages(user_email: "elya.livshitz@gmail.com")
```

## Run

```bash
bun install

# MCP stdio mode (for Claude Code / Cursor / Unclaw)
bun run src/mcp/cli.ts --stdio

# HTTP mode (for testing / direct API)
bun run src/mcp/cli.ts --http --port 3461

# Authenticate a personal Gmail account
bun run src/mcp/cli.ts --auth <email>
```

## Add to your MCP host

Wire the server into an MCP host (Claude Code, Cursor, …) by adding it to your `.mcp.json` (or run `claude mcp add`):

```json
{ "mcpServers": { "gmail": { "command": "bunx", "args": ["mcp-gmail", "--stdio"], "env": { "GOOGLE_SERVICE_ACCOUNT": "./google-service-account.json", "GMAIL_USER_EMAIL": "agent@yourdomain.com" } } } }
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

All tools accept an optional `user_email` parameter for multi-account support.

## Search syntax

The `q` parameter uses [Gmail search syntax](https://support.google.com/mail/answer/7190):

```
from:alice is:unread newer_than:1d
subject:invoice has:attachment
to:me after:2026/01/01
```

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_SERVICE_ACCOUNT` | For Workspace | Path or inline JSON to service account key |
| `GMAIL_USER_EMAIL` | No | Default email (fallback when `user_email` not passed) |
| `GMAIL_OAUTH_CREDENTIALS` | For OAuth | Path to `client_secret.json` |
| `GMAIL_OAUTH_CLIENT_ID` | For OAuth | Alternative to credentials file |
| `GMAIL_OAUTH_CLIENT_SECRET` | For OAuth | Alternative to credentials file |
| `MCP_GMAIL_SPOOL_THRESHOLD` | No | Char limit before spooling to disk (default 12000) |
| `MCP_GMAIL_CACHE_DIR` | No | Spool directory (default `.mcp-gmail/cache/`) |
