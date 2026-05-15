import type { Node, Server } from '@/types/api';
import type { ChainTopologyEdge, ServerTopologyNode } from './types';

const EDGE_PALETTE = [
  '#2563eb',
  '#f97316',
  '#16a34a',
  '#dc2626',
  '#7c3aed',
  '#0891b2',
  '#be123c',
  '#ca8a04',
  '#0f766e',
  '#9333ea',
];

export function stableNodeColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return EDGE_PALETTE[hash % EDGE_PALETTE.length];
}

export function formatBytes(bytes: number, hasStats: boolean): string {
  if (!hasStats) return '-';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

export function formatTimeAgo(isoString: string | null): string {
  if (!isoString) return '';
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  return `${Math.floor(hours / 24)}天前`;
}

export function buildTopology(servers: Server[], nodes: Node[]) {
  const serversById = new Map(servers.map((server) => [server.id, server]));
  const directByServer = new Map<string, Node[]>();
  const chainByEntryServer = new Map<string, Node[]>();
  const incomingChainByExitServer = new Map<string, Node[]>();
  const orphanChainByEntryServer = new Map<string, Node[]>();
  const chainGroups = new Map<string, Node[]>();

  for (const node of nodes) {
    if (!serversById.has(node.serverId)) continue;

    if (!node.exitServerId) {
      const group = directByServer.get(node.serverId) ?? [];
      group.push(node);
      directByServer.set(node.serverId, group);
      continue;
    }

    const entryGroup = chainByEntryServer.get(node.serverId) ?? [];
    entryGroup.push(node);
    chainByEntryServer.set(node.serverId, entryGroup);

    if (!serversById.has(node.exitServerId)) {
      const orphanGroup = orphanChainByEntryServer.get(node.serverId) ?? [];
      orphanGroup.push(node);
      orphanChainByEntryServer.set(node.serverId, orphanGroup);
      continue;
    }

    if (node.enabled) {
      const incomingGroup = incomingChainByExitServer.get(node.exitServerId) ?? [];
      incomingGroup.push(node);
      incomingChainByExitServer.set(node.exitServerId, incomingGroup);
    }

    const key = `${node.serverId}->${node.exitServerId}`;
    const group = chainGroups.get(key) ?? [];
    group.push(node);
    chainGroups.set(key, group);
  }

  const flowNodes: ServerTopologyNode[] = servers.map((server, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    return {
      id: server.id,
      type: 'serverTopology',
      position: { x: column * 500, y: row * 380 },
      data: {
        server,
        directNodes: directByServer.get(server.id) ?? [],
        chainNodes: chainByEntryServer.get(server.id) ?? [],
        incomingChainNodes: incomingChainByExitServer.get(server.id) ?? [],
        orphanChainNodes: orphanChainByEntryServer.get(server.id) ?? [],
        selected: false,
      },
    };
  });

  const edges: ChainTopologyEdge[] = Array.from(chainGroups.entries()).flatMap(([key, chainNodes]) => {
    const [source, target] = key.split('->');
    const entryServer = serversById.get(source);
    const exitServer = serversById.get(target);
    if (!entryServer || !exitServer) return [];

    return [{
      id: `chain:${key}`,
      type: 'multiChain',
      source,
      target,
      data: {
        entryServer,
        exitServer,
        chainNodes,
        colors: chainNodes.map((node) => stableNodeColor(node.id)),
      },
    }];
  });

  return { flowNodes, edges };
}
