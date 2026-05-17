'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Tag, Typography } from 'antd';
import ServerTagList from '@/components/servers/ServerTagList';
import StatusTag from '@/components/common/StatusTag';
import type { Node } from '@/types/api';
import type { ServerTopologyNode } from './types';
import styles from './Topology.module.css';

function ProtocolDots({ nodes }: { nodes: Node[] }) {
  const protocols = Array.from(new Set(nodes.map((node) => node.protocol))).slice(0, 4);
  if (protocols.length === 0) return <span className={styles.emptyText}>暂无</span>;

  return (
    <span className={styles.protocolDots}>
      {protocols.map((protocol) => (
        <Tag key={protocol} color="blue" style={{ margin: 0, fontSize: 11 }}>
          {protocol}
        </Tag>
      ))}
    </span>
  );
}

function NodePreviewList({ nodes, emptyText }: { nodes: Node[]; emptyText: string }) {
  if (nodes.length === 0) {
    return <div className={styles.emptyLine}>{emptyText}</div>;
  }

  return (
    <div className={styles.previewList}>
      {nodes.slice(0, 3).map((node) => (
        <div key={node.id} className={styles.previewItem}>
          <span className={styles.previewName}>{node.name}</span>
          <span className={styles.previewMeta}>:{node.listenPort}</span>
          {!node.enabled && <span className={styles.disabledDot}>停</span>}
        </div>
      ))}
      {nodes.length > 3 && (
        <div className={styles.previewMore}>+{nodes.length - 3} 个更多节点</div>
      )}
    </div>
  );
}

export default function ServerFlowNode({ data, selected }: NodeProps<ServerTopologyNode>) {
  const {
    server,
    directNodes,
    chainNodes,
    orphanChainNodes,
  } = data;

  return (
    <div className={`${styles.serverNode} ${selected ? styles.serverNodeSelected : ''}`}>
      <Handle type="target" position={Position.Left} className={styles.flowHandle} />
      <Handle type="source" position={Position.Right} className={styles.flowHandle} />

      <div className={styles.serverHeader}>
        <div className={styles.serverTitleRow}>
          {server.countryCode && (
            <span
              className={`fi fi-${server.countryCode.toLowerCase()} fis`}
              style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0 }}
            />
          )}
          <Typography.Text strong ellipsis className={styles.serverName}>
            {server.name}
          </Typography.Text>
          <StatusTag status={server.status} />
        </div>
        <div className={styles.serverMeta}>
          <span>{server.ip}</span>
          {server.region && <span>{server.region}</span>}
          {server.pingMs !== null && <span>{server.pingMs}ms</span>}
        </div>
        {(server.tags.length > 0 || (server.autoTags ?? []).length > 0) && (
          <div className={styles.tagLine}>
            <ServerTagList tags={server.tags} autoTags={server.autoTags ?? []} readonly />
          </div>
        )}
      </div>

      <div className={styles.nodeZones}>
        <section className={styles.nodeZone}>
          <div className={styles.zoneHeader}>
            <span>服务端</span>
            <span>{directNodes.length} 个入口</span>
          </div>
          <ProtocolDots nodes={directNodes} />
          <NodePreviewList nodes={directNodes} emptyText="暂无普通入口" />
        </section>

        <section className={styles.nodeZone}>
          <div className={styles.zoneHeader}>
            <span>客户端</span>
            <span>{chainNodes.length} 条链路</span>
          </div>
          <ProtocolDots nodes={chainNodes} />
          <NodePreviewList nodes={chainNodes} emptyText="暂无链式入口" />
          {orphanChainNodes.length > 0 && (
            <div className={styles.warningLine}>{orphanChainNodes.length} 条出口服务器缺失</div>
          )}
        </section>
      </div>
    </div>
  );
}
