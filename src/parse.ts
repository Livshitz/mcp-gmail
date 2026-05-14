export interface ParsedMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  cc?: string;
  subject: string;
  date: string;
  snippet: string;
  labelIds: string[];
  body: string;
  html?: string;
  attachments: { filename: string; mimeType: string; size: number; attachmentId: string }[];
}

export function parseMessage(msg: any): ParsedMessage {
  const headers = msg.payload?.headers ?? [];
  const h = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

  return {
    id: msg.id,
    threadId: msg.threadId,
    from: h('From'),
    to: h('To'),
    cc: h('Cc') || undefined,
    subject: h('Subject'),
    date: h('Date'),
    snippet: msg.snippet ?? '',
    labelIds: msg.labelIds ?? [],
    body: extractBody(msg.payload, 'text/plain'),
    html: extractBody(msg.payload, 'text/html') || undefined,
    attachments: extractAttachments(msg.payload),
  };
}

function extractBody(payload: any, mimeType: string): string {
  if (!payload) return '';
  if (payload.mimeType === mimeType && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  }
  for (const part of payload.parts ?? []) {
    const found = extractBody(part, mimeType);
    if (found) return found;
  }
  return '';
}

function extractAttachments(payload: any): ParsedMessage['attachments'] {
  const result: ParsedMessage['attachments'] = [];
  if (!payload) return result;
  for (const part of payload.parts ?? []) {
    if (part.filename && part.body?.attachmentId) {
      result.push({
        filename: part.filename,
        mimeType: part.mimeType,
        size: part.body.size ?? 0,
        attachmentId: part.body.attachmentId,
      });
    }
    result.push(...extractAttachments(part));
  }
  return result;
}
