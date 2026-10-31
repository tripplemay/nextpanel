export type UsageStatus = 'ACTIVE' | 'IDLE' | 'STALE' | 'PENDING' | 'PAUSED' | 'REVOKING';
export interface UsageRow {
  id: string; subscriptionId: string; subscriptionName: string;
  subjectId: string; subjectName: string; grantKind: 'OWNER' | 'SHARE';
  nodeId: string; nodeName: string; candidateIp: string; carrier: string; label: string;
  status: UsageStatus; sampledAt: string | null; lastActiveAt: string | null; installedAt: string | null;
  upRate: number | null; downRate: number | null; evidence: 'SERVER_CREDENTIAL'; actualEdgeIp: null;
}
export interface UsageNode {
  id: string; name: string; eligible: boolean; observing: boolean; preparedAt: string | null;
  serverId: string; agentVersion: string | null; agentSeenAt: string | null;
  syncedAt: string | null; error: string | null; sampledAt: string | null;
  legacyActiveAt: string | null; fresh: boolean;
}
export interface UsageOverview {
  enabled: boolean; asOf: string; freshnessSeconds: number; activeWindowSeconds: number; limited: boolean;
  rows: UsageRow[]; nodes: UsageNode[];
  subscriptions: { id: string; name: string; enabled: boolean; externalCount: number; automatic: boolean; protectedCount: number }[];
  summary: { activeSubjects: number; activeCandidates: number; preparedNodes: number; freshNodes: number; legacyActiveNodes: number };
}
export interface UsageHistoryPoint { timestamp: string; upBytes: string; downBytes: string }
