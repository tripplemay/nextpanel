import type { Node, Server } from '@/types/api';
import type { ResolvedTheme } from '@/theme/tokens';
import type { ChainTopologyEdge, ServerTopologyNode } from './types';

const EDGE_PALETTE_LIGHT = [
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

/** 暗色链路色板：与亮色同序，整体提亮以保证在 #0d1117 画布上的对比度 */
const EDGE_PALETTE_DARK = [
  '#58a6ff',
  '#ffa657',
  '#3fb950',
  '#f85149',
  '#a371f7',
  '#39c5cf',
  '#f778ba',
  '#e3b341',
  '#2dd4bf',
  '#d2a8ff',
];

export function stableNodeColor(id: string, theme: ResolvedTheme = 'light'): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  const palette = theme === 'dark' ? EDGE_PALETTE_DARK : EDGE_PALETTE_LIGHT;
  return palette[hash % palette.length];
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

export function buildTopology(servers: Server[], nodes: Node[], theme: ResolvedTheme = 'light') {
  const serversById = new Map(servers.map((server) => [server.id, server]));
  const directByServer = new Map<string, Node[]>();
  const chainByEntryServer = new Map<string, Node[]>();
  const orphanChainByEntryServer = new Map<string, Node[]>();
  const chainGroups = new Map<string, Node[]>();

  for (const node of nodes) {
    if (!serversById.has(node.serverId)) continue;

    const isChainNode = node.exitType != null || !!node.exitServerId;
    if (!isChainNode) {
      const group = directByServer.get(node.serverId) ?? [];
      group.push(node);
      directByServer.set(node.serverId, group);
      continue;
    }

    const entryGroup = chainByEntryServer.get(node.serverId) ?? [];
    entryGroup.push(node);
    chainByEntryServer.set(node.serverId, entryGroup);

    if (node.exitType === 'SOCKS5') continue;

    if (!node.exitServerId || !serversById.has(node.exitServerId)) {
      const orphanGroup = orphanChainByEntryServer.get(node.serverId) ?? [];
      orphanGroup.push(node);
      orphanChainByEntryServer.set(node.serverId, orphanGroup);
      continue;
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
        colors: chainNodes.map((node) => stableNodeColor(node.id, theme)),
      },
    }];
  });

  return { flowNodes, edges };
}
