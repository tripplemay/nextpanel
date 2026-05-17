'use client';

import type { ReactNode } from 'react';
import { Button, Empty, Space, Switch, Tag, Tooltip, Typography } from 'antd';
import {
  ApiOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  LinkOutlined,
  PlusOutlined,
  ShareAltOutlined,
} from '@ant-design/icons';
import StatusTag from '@/components/common/StatusTag';
import type { Node } from '@/types/api';
import type { UseNodeActionsResult } from '@/hooks/useNodeActions';
import type { ChainTopologyEdge, InspectorSelection, ServerTopologyNode } from './types';
import { formatBytes, formatTimeAgo, stableNodeColor } from './topology-utils';
import styles from './Topology.module.css';

interface Props {
  selection: InspectorSelection;
  serverNodes: ServerTopologyNode[];
  edges: ChainTopologyEdge[];
  nodeActions: UseNodeActionsResult;
  onClose: () => void;
  onAddDirectNode: (serverId: string) => void;
  onAddChainNode: (entryServerId: string) => void;
}

function ConnectivityTag({ node, nodeActions }: { node: Node; nodeActions: UseNodeActionsResult }) {
  const sessionResult = nodeActions.testResults[node.id];
  const isTestingThis = nodeActions.testingId === node.id || (nodeActions.batchTesting && !sessionResult);

  if (isTestingThis) return <Tag color="processing">测试中</Tag>;

  if (sessionResult) {
    return sessionResult.reachable
      ? <Tag color="green">{sessionResult.latency}ms</Tag>
      : <Tag color="red">失败</Tag>;
  }

  if (!node.lastTestedAt) return <Tag>未测试</Tag>;

  return node.lastReachable
    ? (
      <Tooltip title={formatTimeAgo(node.lastTestedAt)}>
        <Tag color="green">{node.lastLatency}ms</Tag>
      </Tooltip>
    )
    : (
      <Tooltip title={formatTimeAgo(node.lastTestedAt)}>
        <Tag color="red">失败</Tag>
      </Tooltip>
    );
}

function NodeRow({
  node,
  nodeActions,
  missingExit,
}: {
  node: Node;
  nodeActions: UseNodeActionsResult;
  missingExit?: boolean;
}) {
  return (
    <div className={styles.panelNodeRow}>
      <div className={styles.panelNodeMain}>
        <div className={styles.panelNodeTitle}>
          <span
            className={styles.chainColorDot}
            style={{ background: node.exitServerId ? stableNodeColor(node.id) : '#94a3b8' }}
          />
          <Typography.Text strong ellipsis className={styles.panelNodeName}>
            {node.name}
          </Typography.Text>
          <StatusTag status={node.status} enabled={node.enabled} />
        </div>
        <Space size={4} wrap>
          <Tag color="blue">{node.protocol}</Tag>
          {node.transport && <Tag>{node.transport}</Tag>}
          {node.tls !== 'NONE' && <Tag color="green">{node.tls}</Tag>}
          <Tag>:{node.listenPort}</Tag>
          {node.exitServer && <Tag color="purple">出口 {node.exitServer.name}</Tag>}
          {missingExit && <Tag color="red">出口服务器缺失</Tag>}
          <ConnectivityTag node={node} nodeActions={nodeActions} />
          <Tooltip title="累计上传 / 下载">
            <Tag>
              {formatBytes(node.trafficUpBytes, node.statsPort !== null)} / {formatBytes(node.trafficDownBytes, node.statsPort !== null)}
            </Tag>
          </Tooltip>
        </Space>
      </div>
      <div className={styles.panelNodeActions}>
        <Switch
          size="small"
          checked={node.enabled}
          loading={nodeActions.togglingId === node.id}
          onChange={() => nodeActions.toggleNode(node)}
        />
        <Button size="small" icon={<ShareAltOutlined />} onClick={() => nodeActions.openShare(node)} />
        <Button
          size="small"
          icon={<ApiOutlined />}
          loading={nodeActions.testingId === node.id}
          onClick={() => nodeActions.testNode(node)}
        />
        <Button size="small" icon={<CloudUploadOutlined />} onClick={() => nodeActions.openDeploy(node)} />
        <Button size="small" icon={<FileTextOutlined />} onClick={() => nodeActions.openLogs(node)} />
        <Button size="small" icon={<EditOutlined />} onClick={() => nodeActions.openRename(node)} />
        <Button size="small" danger icon={<DeleteOutlined />} onClick={() => nodeActions.confirmDelete(node)} />
      </div>
    </div>
  );
}

function NodeSection({
  title,
  description,
  nodes,
  nodeActions,
  emptyText,
  missingExitIds,
  action,
}: {
  title: string;
  description: string;
  nodes: Node[];
  nodeActions: UseNodeActionsResult;
  emptyText: string;
  missingExitIds?: Set<string>;
  action?: ReactNode;
}) {
  return (
    <section className={styles.panelSection}>
      <div className={styles.panelSectionHeader}>
        <div>
          <Typography.Text strong>{title}</Typography.Text>
          <div className={styles.panelSectionDescription}>{description}</div>
        </div>
        <Space size={8}>
          <Tag>{nodes.length}</Tag>
          {action}
        </Space>
      </div>
      {nodes.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
      ) : (
        <div className={styles.panelNodeList}>
          {nodes.map((node) => (
            <NodeRow
              key={node.id}
              node={node}
              nodeActions={nodeActions}
              missingExit={missingExitIds?.has(node.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default function TopologyInspectorPanel({
  selection,
  serverNodes,
  edges,
  nodeActions,
  onClose,
  onAddDirectNode,
  onAddChainNode,
}: Props) {
  if (!selection) return null;

  if (selection.type === 'edge') {
    const edge = edges.find((item) => item.id === selection.edgeId);
    if (!edge?.data) return null;

    return (
      <aside className={styles.inspectorPanel}>
        <div className={styles.panelTopbar}>
          <div>
            <Typography.Title level={5} style={{ margin: 0 }}>链式链路</Typography.Title>
            <Typography.Text type="secondary">
              {edge.data.entryServer.name} → {edge.data.exitServer.name}
            </Typography.Text>
          </div>
          <Button size="small" onClick={onClose}>关闭</Button>
        </div>
        <NodeSection
          title="链式节点"
          description="这些节点共用同一组入口和出口服务器，在画布上合并为一条多色链路。"
          nodes={edge.data.chainNodes}
          nodeActions={nodeActions}
          emptyText="暂无链式节点"
        />
      </aside>
    );
  }

  const flowNode = serverNodes.find((item) => item.id === selection.serverId);
  if (!flowNode) return null;

  const {
    server,
    directNodes,
    chainNodes,
    orphanChainNodes,
  } = flowNode.data;
  const missingExitIds = new Set(orphanChainNodes.map((node) => node.id));

  return (
    <aside className={styles.inspectorPanel}>
      <div className={styles.panelTopbar}>
        <div>
          <Typography.Title level={5} style={{ margin: 0 }}>{server.name}</Typography.Title>
          <Typography.Text type="secondary">{server.ip} {server.region ? `· ${server.region}` : ''}</Typography.Text>
        </div>
        <Space>
          <Button size="small" onClick={onClose}>关闭</Button>
        </Space>
      </div>
      <NodeSection
        title="服务端"
        description="普通入口节点，仅包含未设置出口服务器的节点。"
        nodes={directNodes}
        nodeActions={nodeActions}
        emptyText="暂无普通入口"
        action={(
          <Button size="small" icon={<PlusOutlined />} onClick={() => onAddDirectNode(server.id)}>
            新增入口
          </Button>
        )}
      />
      <NodeSection
        title="客户端"
        description="链式入口节点，会连接到其他服务器的服务端区域。"
        nodes={chainNodes}
        nodeActions={nodeActions}
        emptyText="暂无链式入口"
        missingExitIds={missingExitIds}
        action={(
          <Button size="small" icon={<LinkOutlined />} onClick={() => onAddChainNode(server.id)}>
            添加连接
          </Button>
        )}
      />
    </aside>
  );
}
