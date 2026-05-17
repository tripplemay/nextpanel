'use client';

import { useCallback, useRef, useState } from 'react';
import { App, Input, Modal } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import { nodesApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useDeployStream } from '@/hooks/useDeployStream';
import DeployDrawer from '@/components/nodes/DeployDrawer';
import NodeShareModal from '@/components/nodes/NodeShareModal';
import DeployLogModal from '@/components/nodes/DeployLogModal';
import type { ConnectivityResult, Node } from '@/types/api';

interface UseNodeActionsOptions {
  nodes: Node[];
}

export interface UseNodeActionsResult {
  testResults: Record<string, ConnectivityResult>;
  testingId: string | null;
  batchTesting: boolean;
  batchProgress: { done: number; total: number } | null;
  togglingId: string | null;
  testNode: (node: Node | string) => void;
  startBatchTest: () => Promise<void>;
  toggleNode: (node: Node | string) => void;
  openDeploy: (node: Node) => void;
  openDelete: (node: Node) => void;
  confirmDelete: (node: Node) => void;
  openRename: (node: Node) => void;
  openShare: (node: Node) => void;
  openLogs: (node: Node) => void;
  modals: React.ReactNode;
}

function nodeId(node: Node | string): string {
  return typeof node === 'string' ? node : node.id;
}

function apiErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as AxiosError<{ message?: string | string[] }>;
  const msgs = axiosErr.response?.data?.message;
  if (Array.isArray(msgs)) return msgs[0] ?? fallback;
  return typeof msgs === 'string' ? msgs : fallback;
}

export function useNodeActions({ nodes }: UseNodeActionsOptions): UseNodeActionsResult {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();

  const [renameNode, setRenameNode] = useState<Node | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deployingNode, setDeployingNode] = useState<Node | null>(null);
  const [deleteDrawerOpen, setDeleteDrawerOpen] = useState(false);
  const [deletingNode, setDeletingNode] = useState<Node | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [shareNode, setShareNode] = useState<Node | null>(null);
  const [logNode, setLogNode] = useState<Node | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, ConnectivityResult>>({});
  const [batchTesting, setBatchTesting] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const abortBatchRef = useRef<AbortController | null>(null);

  const { logLines, deployStatus, startStream, abort, reset } = useDeployStream();
  const {
    logLines: deleteLogLines,
    deployStatus: deleteStatus,
    startStream: startDeleteStream,
    abort: abortDelete,
    reset: resetDelete,
  } = useDeployStream();

  const testMutation = useMutation({
    mutationFn: (id: string) => {
      setTestingId(id);
      return nodesApi.test(id).then((r) => r.data);
    },
    onSuccess: (res, id) => {
      setTestResults((prev) => ({ ...prev, [id]: res }));
      if (res.reachable) message.success(res.message);
      else message.error(res.message);
      qc.invalidateQueries({ queryKey: ['nodes'] });
    },
    onError: () => message.error('测试请求失败'),
    onSettled: () => setTestingId(null),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      nodesApi.rename(id, name).then((r) => r.data),
    onSuccess: () => {
      message.success('节点已重命名');
      setRenameNode(null);
      qc.invalidateQueries({ queryKey: ['nodes'] });
    },
    onError: () => message.error('重命名失败'),
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => {
      setTogglingId(id);
      return nodesApi.toggle(id).then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nodes'] });
    },
    onError: (err) => message.error(apiErrorMessage(err, '切换节点状态失败')),
    onSettled: () => setTogglingId(null),
  });

  const startBatchTest = useCallback(async () => {
    if (batchTesting) {
      abortBatchRef.current?.abort();
      return;
    }

    if (nodes.length === 0) return;

    setBatchTesting(true);
    setBatchProgress({ done: 0, total: nodes.length });
    setTestResults({});
    abortBatchRef.current = new AbortController();

    const token = useAuthStore.getState().token ?? '';

    try {
      const res = await fetch('/api/nodes/test-all', {
        headers: { Authorization: `Bearer ${token}` },
        signal: abortBatchRef.current.signal,
      });

      if (!res.ok || !res.body) {
        void message.error('批量测试请求失败');
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
            const event = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>;
            if (event.type === 'result') {
              const id = event.nodeId as string;
              setTestResults((prev) => ({
                ...prev,
                [id]: {
                  reachable: event.reachable as boolean,
                  latency: event.latency as number,
                  message: event.message as string,
                  testedAt: event.testedAt as string,
                },
              }));
              setBatchProgress((prev) => prev ? { ...prev, done: prev.done + 1 } : null);
            } else if (event.type === 'done') {
              void message.success(`批量测试完成，共 ${event.total as number} 个节点`);
              qc.invalidateQueries({ queryKey: ['nodes'] });
            }
          } catch {
            // Ignore malformed SSE chunks; the stream can continue with later chunks.
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        void message.error('批量测试连接中断');
      }
    } finally {
      setBatchTesting(false);
      setBatchProgress(null);
    }
  }, [batchTesting, message, nodes.length, qc]);

  const openDeploy = useCallback((node: Node) => {
    reset();
    setDeployingNode(node);
    setDrawerOpen(true);
    void startStream(`/api/nodes/${node.id}/deploy-stream`, (success) => {
      if (success) qc.invalidateQueries({ queryKey: ['nodes'] });
    });
  }, [reset, startStream, qc]);

  const openDelete = useCallback((node: Node) => {
    resetDelete();
    setDeletingNode(node);
    setDeleteDrawerOpen(true);
    void startDeleteStream(`/api/nodes/${node.id}/delete-stream`, (success) => {
      if (success) qc.invalidateQueries({ queryKey: ['nodes'] });
    });
  }, [resetDelete, startDeleteStream, qc]);

  const confirmDelete = useCallback((node: Node) => {
    modal.confirm({
      title: '确认删除该节点？',
      content: '将同步停止并移除代理服务器上的对应服务',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => openDelete(node),
    });
  }, [modal, openDelete]);

  const openRename = useCallback((node: Node) => {
    setRenameNode(node);
    setRenameValue(node.name);
  }, []);

  const closeDrawer = useCallback(() => {
    abort();
    setDrawerOpen(false);
  }, [abort]);

  const closeDeleteDrawer = useCallback(() => {
    abortDelete();
    setDeleteDrawerOpen(false);
  }, [abortDelete]);

  const submitRename = useCallback(() => {
    if (renameNode && renameValue.trim()) {
      renameMutation.mutate({ id: renameNode.id, name: renameValue.trim() });
    }
  }, [renameMutation, renameNode, renameValue]);

  const modals = (
    <>
      <Modal
        open={!!renameNode}
        destroyOnHidden
        style={{ maxWidth: '95vw' }}
        title="重命名节点"
        onCancel={() => setRenameNode(null)}
        onOk={submitRename}
        confirmLoading={renameMutation.isPending}
      >
        <Input
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onPressEnter={submitRename}
          placeholder="节点名称"
          style={{ marginTop: 8 }}
        />
      </Modal>

      <DeployDrawer
        open={drawerOpen}
        nodeName={deployingNode?.name ?? null}
        logLines={logLines}
        deployStatus={deployStatus}
        onClose={closeDrawer}
      />

      <DeployDrawer
        open={deleteDrawerOpen}
        nodeName={deletingNode?.name ?? null}
        logLines={deleteLogLines}
        deployStatus={deleteStatus}
        onClose={closeDeleteDrawer}
        actionLabel="删除"
      />

      <NodeShareModal node={shareNode} onClose={() => setShareNode(null)} />

      <DeployLogModal node={logNode} onClose={() => setLogNode(null)} />
    </>
  );

  return {
    testResults,
    testingId,
    batchTesting,
    batchProgress,
    togglingId,
    testNode: (node) => testMutation.mutate(nodeId(node)),
    startBatchTest,
    toggleNode: (node) => toggleMutation.mutate(nodeId(node)),
    openDeploy,
    openDelete,
    confirmDelete,
    openRename,
    openShare: setShareNode,
    openLogs: setLogNode,
    modals,
  };
}
