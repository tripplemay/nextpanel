import {
  Protocol,
  Implementation,
  Transport,
  TlsMode,
  ServerStatus,
  NodeStatus,
  ReleaseStatus,
  ReleaseStrategy,
  ReleaseStepStatus,
  AuditAction,
  UserRole,
} from './enums';

// ──────────────────────────── Server ────────────────────────────

export interface ServerDto {
  id: string;
  name: string;
  region: string;
  provider: string;
  ip: string;
  sshPort: number;
  sshUser: string;
  tags: string[];
  notes: string | null;
  status: ServerStatus;
  cpuUsage: number | null;
  memUsage: number | null;
  diskUsage: number | null;
  lastSeenAt: string | null;
  agentVersion: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateServerDto {
  name: string;
  region: string;
  provider: string;
  ip: string;
  sshPort: number;
  sshUser: string;
  /** PEM-encoded private key or password */
  sshAuthType: 'key' | 'password';
  sshAuth: string;
  tags?: string[];
  notes?: string;
}

export interface UpdateServerDto {
  name?: string;
  region?: string;
  provider?: string;
  ip?: string;
  sshPort?: number;
  sshUser?: string;
  sshAuthType?: 'key' | 'password';
  sshAuth?: string;
  tags?: string[];
  notes?: string;
}

// ──────────────────────────── Node ────────────────────────────

export interface NodeCredentials {
  uuid?: string;
  password?: string;
  method?: string; // for Shadowsocks
  username?: string; // for SOCKS5/HTTP
}

export interface NodeDto {
  id: string;
  serverId: string;
  name: string;
  protocol: Protocol;
  implementation: Implementation | null;
  transport: Transport | null;
  tls: TlsMode;
  listenPort: number;
  domain: string | null;
  status: NodeStatus;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNodeDto {
  serverId: string;
  name: string;
  protocol: Protocol;
  implementation?: Implementation;
  transport?: Transport;
  tls?: TlsMode;
  listenPort: number;
  domain?: string;
  credentials: NodeCredentials;
}

// ──────────────────────────── Template ────────────────────────────

export interface TemplateDto {
  id: string;
  name: string;
  protocol: Protocol;
  implementation: Implementation | null;
  description: string | null;
  content: string; // JSON template string
  variables: string[]; // list of variable names
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTemplateDto {
  name: string;
  protocol: Protocol;
  implementation?: Implementation;
  description?: string;
  content: string;
  variables?: string[];
}

// ──────────────────────────── Release ────────────────────────────

export interface ReleaseDto {
  id: string;
  templateId: string;
  targets: string[]; // server IDs
  strategy: ReleaseStrategy;
  status: ReleaseStatus;
  variables: Record<string, string>;
  steps: ReleaseStepDto[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReleaseStepDto {
  id: string;
  releaseId: string;
  serverId: string;
  status: ReleaseStepStatus;
  log: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface CreateReleaseDto {
  templateId: string;
  targets: string[];
  strategy: ReleaseStrategy;
  variables?: Record<string, string>;
}

// ──────────────────────────── Audit ────────────────────────────

export interface AuditLogDto {
  id: string;
  actor: string;
  action: AuditAction;
  resource: string;
  resourceId: string | null;
  diff: Record<string, unknown> | null;
  ip: string | null;
  timestamp: string;
}

// ──────────────────────────── Auth ────────────────────────────

export interface LoginDto {
  username: string;
  password: string;
}

export interface AuthResponseDto {
  accessToken: string;
  user: {
    id: string;
    username: string;
    role: UserRole;
  };
}

// ──────────────────────────── Subscription ────────────────────────────

export interface SubscriptionDto {
  id: string;
  name: string;
  token: string;
  nodeIds: string[];
  url: string;
  createdAt: string;
}

export interface CreateSubscriptionDto {
  name: string;
  nodeIds: string[];
}

// ──────────────────────────── Metrics ────────────────────────────

export interface ServerMetricsDto {
  serverId: string;
  cpu: number;
  mem: number;
  disk: number;
  networkIn: number;
  networkOut: number;
  timestamp: string;
}

export interface OverviewDto {
  totalServers: number;
  onlineServers: number;
  totalNodes: number;
  runningNodes: number;
}

// ──────────────────────────── API Response ────────────────────────────

export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
