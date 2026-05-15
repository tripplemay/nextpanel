'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type EdgeMouseHandler,
  type NodeMouseHandler,
} from '@xyflow/react';
import { ApiOutlined } from '@ant-design/icons';
import { Button, Card, Empty, Spin, Typography } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import PageHeader from '@/components/common/PageHeader';
import NodePresetModal from '@/components/nodes/NodePresetModal';
import ServerFlowNode from '@/components/nodes/topology/ServerFlowNode';
import MultiChainEdge from '@/components/nodes/topology/MultiChainEdge';
import TopologyInspectorPanel from '@/components/nodes/topology/TopologyInspectorPanel';
import { useNodeActions } from '@/hooks/useNodeActions';
import { nodesApi, serversApi } from '@/lib/api';
import type { Node } from '@/types/api';
import type { ChainTopologyEdge, InspectorSelection, ServerTopologyNode } from '@/components/nodes/topology/types';
import { buildTopology } from '@/components/nodes/topology/topology-utils';
import styles from '@/components/nodes/topology/Topology.module.css';

const EMPTY_NODES: Node[] = [];
const EMPTY_SERVERS: Awaited<ReturnType<typeof serversApi.list>>['data'] = [];

const nodeTypes = {
  serverTopology: ServerFlowNode,
};

const edgeTypes = {
  multiChain: MultiChainEdge,
};

type PresetContext =
  | { mode: 'direct'; serverId: string }
  | { mode: 'chain'; entryServerId: string }
  | null;

export default function NodesV2Page() {
  const qc = useQueryClient();
  const [presetContext, setPresetContext] = useState<PresetContext>(null);
  const [selection, setSelection] = useState<InspectorSelection>(null);
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<ServerTopologyNode>([]);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState<ChainTopologyEdge>([]);

  const { data: allNodesData, isLoading: nodesLoading } = useQuery({
    queryKey: ['nodes'],
    queryFn: () => nodesApi.list().then((r) => r.data),
    staleTime: 2 * 60 * 1000,
  });

  const { data: serversData, isLoading: serversLoading } = useQuery({
    queryKey: ['servers'],
    queryFn: () => serversApi.list().then((r) => r.data),
    refetchInterval: 30_000,
  });

  const allNodes = allNodesData ?? EMPTY_NODES;
  const servers = serversData ?? EMPTY_SERVERS;
  const nodeActions = useNodeActions({ nodes: allNodes });

  const topology = useMemo(() => buildTopology(servers, allNodes), [servers, allNodes]);
  const dataReady = allNodesData !== undefined && serversData !== undefined;

  useEffect(() => {
    if (!dataReady) return;

    setFlowNodes((previous) => {
      const previousById = new Map(previous.map((node) => [node.id, node]));
      return topology.flowNodes.map((node) => {
        const existing = previousById.get(node.id);
        return existing
          ? { ...node, position: existing.position, selected: existing.selected }
          : node;
      });
    });
    setFlowEdges(topology.edges);
  }, [dataReady, setFlowEdges, setFlowNodes, topology]);

  useEffect(() => {
    if (!selection) return;

    if (selection.type === 'server' && !flowNodes.some((node) => node.id === selection.serverId)) {
      setSelection(null);
      return;
    }

    if (selection.type === 'edge' && !flowEdges.some((edge) => edge.id === selection.edgeId)) {
      setSelection(null);
    }
  }, [flowEdges, flowNodes, selection]);

  const handleNodeClick: NodeMouseHandler<ServerTopologyNode> = (_event, node) => {
    setSelection({ type: 'server', serverId: node.id });
  };

  const handleEdgeClick: EdgeMouseHandler<ChainTopologyEdge> = (_event, edge) => {
    setSelection({ type: 'edge', edgeId: edge.id });
  };

  const loading = nodesLoading || serversLoading || !dataReady;

  const batchTestButton = (
    <Button
      icon={<ApiOutlined />}
      loading={nodeActions.batchTesting}
      onClick={() => void nodeActions.startBatchTest()}
    >
      {nodeActions.batchTesting && nodeActions.batchProgress
        ? `测试中 ${nodeActions.batchProgress.done}/${nodeActions.batchProgress.total}`
        : '批量测试'}
    </Button>
  );

  return (
    <Card style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
      <PageHeader
        title="节点拓扑"
        extra={batchTestButton}
      />

      <Spin spinning={loading}>
        {loading ? (
          <div className={styles.topologyShell} />
        ) : servers.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无服务器，先创建服务器后再查看拓扑" style={{ padding: '32px 0' }} />
        ) : (
          <div className={styles.topologyShell}>
            <ReactFlow
              className={styles.flowCanvas}
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={handleNodeClick}
              onEdgeClick={handleEdgeClick}
              onPaneClick={() => setSelection(null)}
              fitView
              minZoom={0.35}
              maxZoom={1.5}
              nodesDraggable
              nodesConnectable={false}
              elementsSelectable
            >
              <Background gap={18} size={1} color="#b9c7db" />
              <Controls position="bottom-left" />
              <MiniMap
                zoomable
                pannable
                position="bottom-right"
                nodeColor={(node) => node.selected ? '#2563eb' : '#94a3b8'}
              />
            </ReactFlow>

            {!loading && allNodes.length === 0 && (
              <div style={{ position: 'absolute', left: 20, bottom: 20, zIndex: 8 }}>
                <Card size="small">
                  <Typography.Text type="secondary">
                    当前还没有节点。可以先在节点管理中创建节点，再回到拓扑视图查看关系。
                  </Typography.Text>
                </Card>
              </div>
            )}

            <TopologyInspectorPanel
              selection={selection}
              serverNodes={flowNodes}
              edges={flowEdges}
              nodeActions={nodeActions}
              onClose={() => setSelection(null)}
              onAddDirectNode={(serverId) => setPresetContext({ mode: 'direct', serverId })}
              onAddChainNode={(entryServerId) => setPresetContext({ mode: 'chain', entryServerId })}
            />
          </div>
        )}
      </Spin>

      <NodePresetModal
        open={presetContext !== null}
        title={presetContext?.mode === 'chain' ? '添加连接' : '新增入口'}
        onClose={() => setPresetContext(null)}
        onSuccess={(node: Node) => {
          setPresetContext(null);
          qc.invalidateQueries({ queryKey: ['nodes'] });
          nodeActions.openDeploy(node);
        }}
        defaultDeployMode={presetContext?.mode}
        defaultServerId={presetContext?.mode === 'direct' ? presetContext.serverId : undefined}
        defaultEntryServerId={presetContext?.mode === 'chain' ? presetContext.entryServerId : undefined}
        lockDeployMode
        lockServerId={presetContext?.mode === 'direct'}
        lockEntryServerId={presetContext?.mode === 'chain'}
      />

      {nodeActions.modals}
    </Card>
  );
}
