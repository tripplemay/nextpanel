// ── Request DTOs ──────────────────────────────────────────────────────────────

export interface CreateServerDto {
  name: string;
  ip: string;
  sshPort: number;
  sshUser: string;
  sshAuth: string;
  sshAuthType: 'PASSWORD' | 'KEY';
  tags?: string[];
}

export interface UpdateServerDto extends Partial<CreateServerDto> {}

export interface CreateNodeDto {
  serverId: string;
  name: string;
  protocol: string;
  implementation?: string;
  transport?: string;
  tls?: string;
  listenPort: number;
  domain?: string;
  credentials: Record<string, string>;
  enabled?: boolean;
}

export interface UpdateNodeDto extends Partial<Omit<CreateNodeDto, 'serverId'>> {}

export interface CreateNodeFromPresetDto {
  serverId: string;
  name: string;
  preset: string;
}

export interface CloudflareSetting {
  domain: string;
  zoneId: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertCloudflareSettingDto {
  apiToken: string;
  zoneId: string;
  domain: string;
}

export interface CreateSubscriptionDto {
  name: string;
  nodeIds: string[];
}

// ── Response types ────────────────────────────────────────────────────────────

export interface Server {
  id: string;
  name: string;
  ip: string;
  sshPort: number;
  sshUser: string;
  sshAuthType: 'PASSWORD' | 'KEY';
  tags: string[];
  status: string;
  region: string;
  provider: string;
  cpuUsage: number | null;
  memUsage: number | null;
  diskUsage: number | null;
  networkIn: number | null;
  networkOut: number | null;
  pingMs: number | null;
  notes: string | null;
  lastSeenAt: string | null;
  agentVersion: string | null;
  agentToken: string;
  deleteError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Node {
  id: string;
  serverId: string;
  server?: Pick<Server, 'id' | 'name' | 'ip'>;
  name: string;
  protocol: string;
  implementation: string | null;
  transport: string | null;
  tls: string;
  listenPort: number;
  domain: string | null;
  source: 'MANUAL' | 'AUTO';
  status: string;
  enabled: boolean;
  lastReachable: boolean | null;
  lastLatency: number | null;
  lastTestedAt: string | null;
  statsPort: number | null;
  trafficUpBytes: number;
  trafficDownBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface Subscription {
  id: string;
  name: string;
  token: string;
  nodes: Array<{ node: Pick<Node, 'id' | 'name' | 'protocol'> }>;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  actor: { username: string };
  action: string;
  resource: string;
  resourceId: string | null;
  diff: unknown;
  ip: string | null;
  correlationId: string | null;
  timestamp: string;
}

export interface Metric {
  id: string;
  serverId: string;
  cpu: number;
  mem: number;
  disk: number;
  networkIn: number;
  networkOut: number;
  timestamp: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ConnectivityResult {
  reachable: boolean;
  latency: number;
  message: string;
  testedAt: string;
}

export interface OperationLogEntry {
  id: string;
  resourceType: string;
  resourceName: string;
  actorId: string | null;
  operation: string;
  correlationId: string | null;
  success: boolean;
  durationMs: number | null;
  createdAt: string;
}

export interface OperationLogDetail extends OperationLogEntry {
  log: string | null;
}
