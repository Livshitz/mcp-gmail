import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DEFAULT_DIR = '.mcp-gmail/cache';

export function spoolThreshold(): number {
  const n = parseInt(process.env.MCP_GMAIL_SPOOL_THRESHOLD ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 12_000;
}

export function cacheDir(): string {
  const d = process.env.MCP_GMAIL_CACHE_DIR?.trim();
  return resolve(d || DEFAULT_DIR);
}

function summarize(p: unknown): Record<string, unknown> {
  if (!p || typeof p !== 'object') return { type: typeof p };
  const o = p as Record<string, unknown>;
  if (Array.isArray(o.messages)) return { messageCount: o.messages.length };
  if (Array.isArray(o.threads)) return { threadCount: o.threads.length };
  if (Array.isArray(o.labels)) return { labelCount: o.labels.length };
  return { keys: Object.keys(o).slice(0, 12) };
}

export function inlineOrSpool(toolSlug: string, payload: unknown): unknown {
  const json = JSON.stringify(payload);
  if (json.length <= spoolThreshold()) return payload;

  const dir = cacheDir();
  mkdirSync(dir, { recursive: true });
  const safe = toolSlug.replace(/[^a-z0-9_-]/gi, '_');
  const file = join(dir, `${safe}_${Date.now()}.json`);
  writeFileSync(file, json, 'utf-8');

  return {
    spooled: true,
    file,
    type: 'json',
    sizeBytes: Buffer.byteLength(json, 'utf8'),
    count: summarize(payload),
    preview: Array.isArray(payload) ? payload.slice(0, 2) : undefined,
    hint: 'Large Gmail result written to disk. Use the Read tool on `file` to access full data.',
  };
}
