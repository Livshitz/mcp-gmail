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
}

export function buildRawMessage(opts: MessageOpts): string {
  const boundary = `----=_Part_${Date.now()}`;
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

  if (opts.html) {
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`, '');
    lines.push(`--${boundary}`, 'Content-Type: text/plain; charset=utf-8', '', opts.body);
    lines.push(`--${boundary}`, 'Content-Type: text/html; charset=utf-8', '', opts.html);
    lines.push(`--${boundary}--`);
  } else {
    lines.push('Content-Type: text/plain; charset=utf-8', '', opts.body);
  }

  const raw = lines.join('\r\n');
  return Buffer.from(raw).toString('base64url');
}
