'use client';

import { useAuthStore } from '@/store/auth';
import { readSse, type SseStreamResult } from './sse-client';
export type { SseStreamResult } from './sse-client';

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
  return readSse(url, useAuthStore.getState().token ?? '', onEvent, signal);
}
