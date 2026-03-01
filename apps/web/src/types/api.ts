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

export interface CreatePipelineDto {
  name: string;
  repoUrl: string;
  branch: string;
  workDir: string;
  buildCommands: string[];
  deployCommands: string[];
  serverIds: string[];
  githubToken?: string;
  enabled?: boolean;
}

export interface UpdatePipelineDto extends Partial<CreatePipelineDto> {}

export interface CreateTemplateDto {
  name: string;
  protocol: string;
  implementation?: string;
  content: string;
  variables?: string[];
}

export interface UpdateTemplateDto extends Partial<CreateTemplateDto> {}

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
  lastSeenAt: string | null;
  agentVersion: string | null;
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
  status: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Pipeline {
  id: string;
  name: string;
  repoUrl: string;
  branch: string;
  workDir: string;
  buildCommands: string[];
  deployCommands: string[];
  serverIds: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Template {
  id: string;
  name: string;
  protocol: string;
  implementation: string | null;
  content: string;
  variables: string[];
  createdAt: string;
  createdBy: { username: string };
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
  serverId: string;
  cpu: number;
  mem: number;
  disk: number;
  timestamp: string;
}

export interface GithubSecret {
  name: string;
  value: string;
  description: string;
}

export interface GithubConfig {
  yaml: string;
  secrets: GithubSecret[];
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
