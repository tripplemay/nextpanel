'use client';

import { useRef, useState, useCallback } from 'react';
import { streamSse } from '@/lib/sse';

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

    const result = await streamSse(url, (json) => {
      onRawEvent?.(json);
      if (json.log) {
        setLogLines((prev) => [...prev, json.log as string]);
      }
      if (json.done) {
        const success = (json.success as boolean) ?? false;
        setDeployStatus(success ? 'success' : 'failed');
        onDone?.(success);
      }
    }, abortRef.current.signal);

    if (!result.ok) {
      setLogLines((prev) => [
        ...prev,
        result.status ? `Error: HTTP ${result.status}` : `连接中断: ${result.error}`,
      ]);
      setDeployStatus('failed');
      onDone?.(false);
    }
  }, []);

  return { logLines, deployStatus, startStream, abort, reset };
}
