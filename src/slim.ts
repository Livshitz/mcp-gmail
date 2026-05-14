export function slimMessages(messages: any[]): any[] {
  return messages.map((m) => ({
    id: m.id,
    threadId: m.threadId,
    snippet: m.snippet,
    labelIds: m.labelIds,
    internalDate: m.internalDate,
  }));
}

export function slimThread(thread: any): any {
  return {
    id: thread.id,
    snippet: thread.snippet,
    historyId: thread.historyId,
    messageCount: thread.messages?.length ?? 0,
    messages: (thread.messages ?? []).map((m: any) => {
      const headers = m.payload?.headers ?? [];
      const h = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
      return {
        id: m.id,
        from: h('From'),
        subject: h('Subject'),
        date: h('Date'),
        snippet: m.snippet,
      };
    }),
  };
}
