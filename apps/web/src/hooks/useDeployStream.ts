'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { streamSse } from '@/lib/sse';

export type DeployStatus = 'idle' | 'running' | 'success' | 'failed' | 'interrupted' | 'cancelled';

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
    abortRef.current?.abort();
    abortRef.current = null;
    setLogLines([]);
    setDeployStatus('idle');
  }, []);

  useEffect(() => () => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const startStream = useCallback(async (url: string, onDone?: (success: boolean) => void, onRawEvent?: (json: Record<string, unknown>) => void) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLogLines([]);
    setDeployStatus('running');

    const result = await streamSse(url, (json) => {
      if (abortRef.current !== controller || controller.signal.aborted) return;
      onRawEvent?.(json);
      if (json.log) {
        setLogLines((prev) => [...prev, json.log as string]);
      }
    }, controller.signal);

    // A cancelled/replaced request must never settle a newer operation.
    if (abortRef.current !== controller) return;
    abortRef.current = null;
    setDeployStatus(result.outcome);
    if (result.outcome === 'interrupted' || result.status) {
      setLogLines((prev) => [
        ...prev,
        result.status ? `Error: HTTP ${result.status}` : `连接中断，远端结果未知，请核对状态后再操作: ${result.error}`,
      ]);
    }
    if (result.outcome !== 'cancelled') onDone?.(result.outcome === 'success');
  }, []);

  return { logLines, deployStatus, startStream, abort, reset };
}
