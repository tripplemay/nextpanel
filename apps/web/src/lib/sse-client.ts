export type StreamOutcome = 'success' | 'failed' | 'interrupted' | 'cancelled';

export interface SseStreamResult {
  outcome: StreamOutcome;
  status?: number;
  error?: string;
}

const MAX_EVENT_BUFFER = 1024 * 1024;

/** Transport EOF is not evidence that a remote operation completed. */
export async function readSse(
  url: string,
  token: string,
  onEvent: (event: Record<string, unknown>) => void,
  signal?: AbortSignal,
): Promise<SseStreamResult> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancel = () => { void reader?.cancel().catch(() => undefined); };
  try {
    if (signal?.aborted) return { outcome: 'cancelled' };
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal });
    if (!res.ok) {
      void res.body?.cancel().catch(() => undefined);
      return { outcome: 'failed', status: res.status };
    }
    if (!res.body || !res.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
      void res.body?.cancel().catch(() => undefined);
      return { outcome: 'interrupted', error: 'Invalid SSE response' };
    }
    reader = res.body.getReader();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) return { outcome: 'cancelled' };
    const decoder = new TextDecoder();
    let buffer = '';
    let data: string[] = [];
    let eventSize = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (signal?.aborted) return { outcome: 'cancelled' };
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.search(/[\r\n]/)) !== -1) {
        // Keep a trailing CR until we know whether the next chunk starts with LF.
        if (!done && buffer[end] === '\r' && end === buffer.length - 1) break;
        const line = buffer.slice(0, end);
        const separator = buffer.slice(end, end + 2) === '\r\n' ? 2 : 1;
        buffer = buffer.slice(end + separator);
        eventSize += line.length;
        if (eventSize > MAX_EVENT_BUFFER) throw new Error('SSE event exceeds size limit');
        if (line === '') {
          eventSize = 0;
          if (!data.length) continue;
          const json: unknown = JSON.parse(data.join('\n'));
          data = [];
          if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('Invalid SSE event');
          const event = json as Record<string, unknown>;
          const terminal = event.done === true || event.type === 'done';
          if (event.done === true && typeof event.success !== 'boolean') throw new Error('Missing task result');
          onEvent(event);
          if (terminal) return { outcome: event.success === false ? 'failed' : 'success' };
        } else if (line.startsWith('data:')) {
          data.push(line.slice(5).replace(/^ /, ''));
        }
      }
      if (buffer.length + eventSize > MAX_EVENT_BUFFER) throw new Error('SSE event exceeds size limit');
      if (done) return { outcome: 'interrupted', error: 'Stream ended without a terminal event' };
    }
  } catch (err) {
    if (signal?.aborted) return { outcome: 'cancelled' };
    return { outcome: 'interrupted', error: err instanceof Error ? err.message : String(err) };
  } finally {
    signal?.removeEventListener('abort', cancel);
    cancel();
    reader?.releaseLock();
  }
}
