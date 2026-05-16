import type { Edge, Node as FlowNode } from '@xyflow/react';
import type { Node, Server } from '@/types/api';

export interface ServerTopologyData extends Record<string, unknown> {
  server: Server;
  directNodes: Node[];
  chainNodes: Node[];
  orphanChainNodes: Node[];
  selected: boolean;
}

export interface ChainEdgeData extends Record<string, unknown> {
  entryServer: Server;
  exitServer: Server;
  chainNodes: Node[];
  colors: string[];
}

export type ServerTopologyNode = FlowNode<ServerTopologyData, 'serverTopology'>;
export type ChainTopologyEdge = Edge<ChainEdgeData, 'multiChain'>;

export type InspectorSelection =
  | { type: 'server'; serverId: string }
  | { type: 'edge'; edgeId: string }
  | null;
