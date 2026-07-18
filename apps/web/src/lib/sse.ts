'use client';

import { useAuthStore } from '@/store/auth';

export interface SseStreamResult {
  /** 流正常结束（含后端主动 done） */
  ok: boolean;
  /** HTTP 非 2xx 时的状态码 */
  status?: number;
  /** 网络层错误信息（AbortError 不算） */
  error?: string;
}

/**
 * 通用 SSE 流式读取。
 * 后端 SSE 端点需要 `Authorization: Bearer` 头，EventSource 不支持自定义头，
 * 因此统一用 fetch + ReadableStream 手工解析（data: 行为 JSON）。
 * 部署/删除/安装/自动配置/批量测试等所有 SSE 调用方共用此实现。
 */
export async function streamSse(
  url: string,
  onEvent: (json: Record<string, unknown>) => void,
  signal?: AbortSignal,
): Promise<SseStreamResult> {
  const token = useAuthStore.getState().token ?? '';

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });

    if (!res.ok || !res.body) {
      return { ok: false, status: res.status };
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
          onEvent(JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>);
        } catch {
          // 忽略无法解析的事件，流继续
        }
      }
    }
    return { ok: true };
  } catch (err: unknown) {
    if ((err as Error).name === 'AbortError') {
      return { ok: true };
    }
    return { ok: false, error: (err as Error).message };
  }
}
