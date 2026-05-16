import { readFileSync, existsSync } from 'node:fs';
import { basename, extname } from 'node:path';

export interface Attachment {
  path: string;
  filename?: string;
  mimeType?: string;
}

export interface MessageOpts {
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  html?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: Attachment[];
}

function plainToHtml(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div style="font-family:sans-serif;font-size:14px">${escaped.replace(/\n/g, '<br>')}</div>`;
}

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
  '.csv': 'text/csv', '.json': 'application/json', '.txt': 'text/plain',
  '.html': 'text/html', '.zip': 'application/zip', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function guessMime(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

export function buildRawMessage(opts: MessageOpts): string {
  const lines: string[] = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
  ];
  if (opts.cc) lines.push(`Cc: ${opts.cc}`);
  if (opts.bcc) lines.push(`Bcc: ${opts.bcc}`);
  lines.push(`Subject: ${opts.subject}`);
  if (opts.inReplyTo) lines.push(`In-Reply-To: ${opts.inReplyTo}`);
  if (opts.references) lines.push(`References: ${opts.references}`);
  lines.push(`MIME-Version: 1.0`);

  const html = opts.html || plainToHtml(opts.body);
  const hasAttachments = opts.attachments?.length;

  if (!hasAttachments) {
    const boundary = `----=_Part_${Date.now()}`;
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`, '');
    lines.push(`--${boundary}`, 'Content-Type: text/plain; charset=utf-8', '', opts.body);
    lines.push(`--${boundary}`, 'Content-Type: text/html; charset=utf-8', '', html);
    lines.push(`--${boundary}--`);
  } else {
    const mixedBoundary = `----=_Mixed_${Date.now()}`;
    const altBoundary = `----=_Alt_${Date.now()}_inner`;
    lines.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`, '');

    lines.push(`--${mixedBoundary}`);
    lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`, '');
    lines.push(`--${altBoundary}`, 'Content-Type: text/plain; charset=utf-8', '', opts.body);
    lines.push(`--${altBoundary}`, 'Content-Type: text/html; charset=utf-8', '', html);
    lines.push(`--${altBoundary}--`, '');

    for (const att of opts.attachments!) {
      if (!existsSync(att.path)) throw new Error(`Attachment not found: ${att.path}`);
      const data = readFileSync(att.path);
      const name = att.filename ?? basename(att.path);
      const mime = att.mimeType ?? guessMime(att.path);
      lines.push(`--${mixedBoundary}`);
      lines.push(`Content-Type: ${mime}; name="${name}"`);
      lines.push(`Content-Disposition: attachment; filename="${name}"`);
      lines.push(`Content-Transfer-Encoding: base64`, '');
      const b64 = data.toString('base64');
      for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
      lines.push('');
    }
    lines.push(`--${mixedBoundary}--`);
  }

  const raw = lines.join('\r\n');
  return Buffer.from(raw).toString('base64url');
}
