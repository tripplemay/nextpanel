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

export interface WxWorkSetting {
  id: string;
  corpId: string;
  agentId: string;
  proxyUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertWxWorkSettingDto {
  corpId: string;
  agentId: string;
  secret: string;
  proxyUrl?: string;
}

export interface UpsertCloudflareSettingDto {
  apiToken: string;
  zoneId: string;
  domain: string;
}

export interface CreateSubscriptionDto {
  name: string;
  nodeIds: string[];
  externalNodeIds?: string[];
}

export interface UpdateSubscriptionDto {
  name?: string;
  nodeIds?: string[];
  externalNodeIds?: string[];
}

export interface RegisterDto {
  username: string;
  password: string;
  inviteCode: string;
}

// ── Users ─────────────────────────────────────────────────────────────────────

export interface UserRecord {
  id: string;
  username: string;
  role: 'ADMIN' | 'OPERATOR' | 'VIEWER';
  createdAt: string;
}

// ── InviteCodes ───────────────────────────────────────────────────────────────

export interface InviteCode {
  id: string;
  code: string;
  maxUses: number;
  usedCount: number;
  createdBy: string;
  creator: { username: string };
  createdAt: string;
}

// ── Response types ────────────────────────────────────────────────────────────

export interface ServerIpCheck {
  id: string;
  serverId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  // IP basic info
  ipType: 'RESIDENTIAL' | 'DATACENTER' | null;
  asn: string | null;
  org: string | null;
  country: string | null;
  city: string | null;
  // Streaming / AI
  netflix: 'UNLOCKED' | 'ORIGINALS_ONLY' | 'BLOCKED' | null;
  netflixRegion: string | null;
  disney: 'AVAILABLE' | 'BLOCKED' | null;
  disneyRegion: string | null;
  youtube: 'AVAILABLE' | 'BLOCKED' | null;
  youtubeRegion: string | null;
  hulu: 'AVAILABLE' | 'BLOCKED' | null;
  bilibili: 'AVAILABLE' | 'BLOCKED' | null;
  openai: 'AVAILABLE' | 'BLOCKED' | null;
  claude: 'AVAILABLE' | 'BLOCKED' | null;
  gemini: 'AVAILABLE' | 'BLOCKED' | null;
  // GFW
  gfwBlocked: boolean | null;
  gfwCheckedAt: string | null;
  // Route check
  routeData: RouteData | null;
  createdAt: string;
  updatedAt: string;
}

export interface RouteHop {
  n: number;
  ip: string;
  asn?: string;
  org?: string;
  ms: number; // -1 = timeout
}

export interface OutboundNode {
  isp: string;
  city: string;
  ip: string;
  pingMs: number; // -1 = unreachable
  tcpMs: number;
  loss: number;
  hops?: RouteHop[];
}

export interface InboundNode {
  isp: string;
  city: string;
  pingMs: number;
  loss: number;
  source: string;
}

export interface RouteData {
  checkedAt: string;
  outbound: OutboundNode[];
  inbound?: InboundNode[];
}

export interface Server {
  id: string;
  name: string;
  ip: string;
  sshPort: number;
  sshUser: string;
  sshAuthType: 'PASSWORD' | 'KEY';
  tags: string[];
  autoTags: string[];
  status: string;
  region: string;
  countryCode: string | null;
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
  pendingAgentUpdate: boolean;
  credentialsDestroyed: boolean;
  deleteError: string | null;
  createdAt: string;
  updatedAt: string;
  ipCheck?: { gfwBlocked: boolean | null } | null;
}

export interface Node {
  id: string;
  serverId: string;
  server?: Pick<Server, 'id' | 'name' | 'ip' | 'tags' | 'autoTags'>;
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

export interface ExternalNode {
  id: string;
  userId: string;
  name: string;
  protocol: string;
  address: string;
  port: number;
  uuid: string | null;
  password: string | null;
  method: string | null;
  transport: string | null;
  tls: string;
  sni: string | null;
  path: string | null;
  rawUri: string | null;
  lastReachable: boolean | null;
  lastLatency: number | null;
  lastTestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Subscription {
  id: string;
  name: string;
  token: string;
  nodes: Array<{ node: Pick<Node, 'id' | 'name' | 'protocol' | 'status' | 'enabled' | 'listenPort' | 'serverId' | 'server'> }>;
  externalNodes: Array<{ externalNode: Pick<ExternalNode, 'id' | 'name' | 'protocol' | 'address' | 'port'> }>;
  /** Present for owner view — list of user IDs this subscription is shared with */
  shares?: Array<{ id: string; userId: string }>;
  /** Present for VIEWER view — the VIEWER's personal shareToken */
  shareToken?: string;
  createdAt: string;
}

export interface ViewerSubscriptionList {
  mine: Subscription[];
  shared: Subscription[];
}

export interface SubscriptionShare {
  id: string;
  subscriptionId: string;
  userId: string;
  shareToken: string;
  createdAt: string;
  user: { id: string; username: string; role: string };
}

export interface OpenRouterSetting {
  id: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertOpenRouterSettingDto {
  apiKey: string;
  model?: string;
}

export interface ServerRecommendCategory {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  color: string | null;
  featuredId: string | null;
  recommends: Array<{ recommend: ServerRecommend }>;
  createdAt: string;
}

export interface ServerRecommend {
  id: string;
  name: string;
  price: string;
  regions: string[];
  link: string;
  sortOrder: number;
  categories?: Array<{ category: { id: string; name: string } }>;
  createdAt: string;
}

export interface ExtractResult {
  name: string;
  price: string;
  regions: string[];
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
