'use client';

import { useCallback, useRef, useState } from 'react';
import { App, Input, Modal, Select } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import { nodesApi } from '@/lib/api';
import { streamSse } from '@/lib/sse';
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
  openEgressPolicy: (node: Node) => void;
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
  const [egressPolicyNode, setEgressPolicyNode] = useState<Node | null>(null);
  const [egressIpPolicy, setEgressIpPolicy] = useState<'AUTO' | 'IPV4_ONLY'>('AUTO');
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
    onMutate: async ({ id, name }) => {
      // 乐观更新：先把列表里的名字改掉，失败再回滚
      await qc.cancelQueries({ queryKey: ['nodes'] });
      const previous = qc.getQueriesData<Node[]>({ queryKey: ['nodes'] });
      qc.setQueriesData<Node[]>({ queryKey: ['nodes'] }, (old) =>
        old?.map((n) => (n.id === id ? { ...n, name } : n)),
      );
      return { previous };
    },
    onSuccess: () => {
      message.success('节点已重命名');
      setRenameNode(null);
    },
    onError: (err, _vars, context) => {
      context?.previous?.forEach(([key, data]) => qc.setQueryData(key, data));
      message.error(apiErrorMessage(err, '重命名失败'));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['nodes'] });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => {
      setTogglingId(id);
      return nodesApi.toggle(id).then((r) => r.data);
    },
    onMutate: async (id) => {
      // 乐观更新：先翻转开关状态，失败再回滚
      await qc.cancelQueries({ queryKey: ['nodes'] });
      const previous = qc.getQueriesData<Node[]>({ queryKey: ['nodes'] });
      qc.setQueriesData<Node[]>({ queryKey: ['nodes'] }, (old) =>
        old?.map((n) => (n.id === id ? { ...n, enabled: !n.enabled } : n)),
      );
      return { previous };
    },
    onError: (err, _id, context) => {
      context?.previous?.forEach(([key, data]) => qc.setQueryData(key, data));
      message.error(apiErrorMessage(err, '切换节点状态失败'));
    },
    onSettled: () => {
      setTogglingId(null);
      qc.invalidateQueries({ queryKey: ['nodes'] });
    },
  });

  const egressPolicyMutation = useMutation({
    mutationFn: ({ id, policy }: { id: string; policy: 'AUTO' | 'IPV4_ONLY' }) =>
      nodesApi.update(id, { egressIpPolicy: policy }).then((r) => r.data),
    onSuccess: (updated) => {
      qc.setQueriesData<Node[]>({ queryKey: ['nodes'] }, (old) =>
        old?.map((node) => (node.id === updated.id ? updated : node)),
      );
      message.success('出口 IP 策略已更新，节点正在重新部署');
      setEgressPolicyNode(null);
    },
    onError: (err) => {
      message.error(apiErrorMessage(err, '出口 IP 策略更新失败'));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['nodes'] });
    },
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

    const result = await streamSse(
      '/api/nodes/test-all',
      (event) => {
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
      },
      abortBatchRef.current.signal,
    );

    if (!result.ok) {
      void message.error(result.status ? '批量测试请求失败' : '批量测试连接中断');
    }
    setBatchTesting(false);
    setBatchProgress(null);
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

  const openEgressPolicy = useCallback((node: Node) => {
    if ((node.implementation ?? 'XRAY') !== 'XRAY') {
      void message.warning('仅 Xray 节点支持出口 IP 策略');
      return;
    }
    setEgressPolicyNode(node);
    setEgressIpPolicy(node.egressIpPolicy);
  }, [message]);

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

      <Modal
        open={!!egressPolicyNode}
        destroyOnHidden
        style={{ maxWidth: '95vw' }}
        title="出口 IP 策略"
        onCancel={() => setEgressPolicyNode(null)}
        onOk={() => {
          if (egressPolicyNode) {
            egressPolicyMutation.mutate({
              id: egressPolicyNode.id,
              policy: egressIpPolicy,
            });
          }
        }}
        confirmLoading={egressPolicyMutation.isPending}
      >
        <Select
          value={egressIpPolicy}
          onChange={setEgressIpPolicy}
          style={{ width: '100%', marginTop: 8 }}
          options={[
            { label: '自动（双栈）', value: 'AUTO' },
            { label: '仅 IPv4', value: 'IPV4_ONLY' },
          ]}
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
    openEgressPolicy,
    openShare: setShareNode,
    openLogs: setLogNode,
    modals,
  };
}
