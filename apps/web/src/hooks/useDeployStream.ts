'use client';

import { useRef, useState, useCallback } from 'react';
import { useAuthStore } from '@/store/auth';

export type DeployStatus = 'idle' | 'running' | 'success' | 'failed';

export interface UseDeployStreamResult {
  logLines: string[];
  deployStatus: DeployStatus;
  startStream: (url: string, onDone?: (success: boolean) => void, onRawEvent?: (json: Record<string, unknown>) => void) => Promise<void>;
  abort: () => void;
  reset: () => void;
}

export function useDeployStream(): UseDeployStreamResult {
  const [logLines, setLogLines] = useState<string[]>([]);
  const [deployStatus, setDeployStatus] = useState<DeployStatus>('idle');
  const abortRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    setLogLines([]);
    setDeployStatus('idle');
  }, []);

  const startStream = useCallback(async (url: string, onDone?: (success: boolean) => void, onRawEvent?: (json: Record<string, unknown>) => void) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setLogLines([]);
    setDeployStatus('running');

    const token = useAuthStore.getState().token ?? '';

    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) {
        setLogLines((prev) => [...prev, `Error: HTTP ${res.status}`]);
        setDeployStatus('failed');
        onDone?.(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';

        for (const chunk of chunks) {
          const dataLine = chunk.split('\n').find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          try {
            const json = JSON.parse(dataLine.slice(5).trim()) as {
              log?: string;
              done?: boolean;
              success?: boolean;
              [key: string]: unknown;
            };
            onRawEvent?.(json);
            if (json.log) {
              setLogLines((prev) => [...prev, json.log!]);
            }
            if (json.done) {
              const success = json.success ?? false;
              setDeployStatus(success ? 'success' : 'failed');
              onDone?.(success);
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        setLogLines((prev) => [...prev, `连接中断: ${(err as Error).message}`]);
        setDeployStatus('failed');
        onDone?.(false);
      }
    }
  }, []);

  return { logLines, deployStatus, startStream, abort, reset };
}
