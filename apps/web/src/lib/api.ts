import axios from 'axios';
import { useAuthStore } from '@/store/auth';
import type {
  Server,
  Node,
  ExternalNode,
  WxWorkSetting,
  UpsertWxWorkSettingDto,
  Subscription,
  SubscriptionShare,
  ViewerSubscriptionList,
  Metric,
  ConnectivityResult,
  PaginatedResponse,
  AuditLog,
  OperationLogEntry,
  OperationLogDetail,
  CloudflareSetting,
  CreateServerDto,
  UpdateServerDto,
  CreateNodeDto,
  UpdateNodeDto,
  CreateNodeFromPresetDto,
  CreateSubscriptionDto,
  UpdateSubscriptionDto,
  UpsertCloudflareSettingDto,
  RegisterDto,
  UserRecord,
  InviteCode,
  ServerIpCheck,
  OpenRouterSetting,
  UpsertOpenRouterSettingDto,
  ServerRecommendCategory,
  ExtractResult,
} from '@/types/api';

export const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (
      error.response?.status === 401 &&
      typeof window !== 'undefined' &&
      !window.location.pathname.startsWith('/login')
    ) {
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

// ── Auth ──────────────────────────────────────────────
export const authApi = {
  login: (username: string, password: string) =>
    api.post<{ accessToken: string; user: { id: string; username: string; role: string } }>(
      '/auth/login',
      { username, password },
    ),
  register: (data: RegisterDto) =>
    api.post<{ id: string; username: string; role: string }>('/auth/register', data),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.patch<void>('/auth/change-password', { currentPassword, newPassword }),
  logout: () => api.post<void>('/auth/logout'),
};

// ── Servers ──────────────────────────────────────────
export const serversApi = {
  list: () => api.get<Server[]>('/servers'),
  get: (id: string) => api.get<Server>(`/servers/${id}`),
  create: (data: CreateServerDto) => api.post<Server>('/servers', data),
  update: (id: string, data: UpdateServerDto) => api.patch<Server>(`/servers/${id}`, data),
  delete: (id: string, force?: boolean) => api.delete<void>(`/servers/${id}`, { params: force ? { force: 'true' } : {} }),
  testSsh: (id: string) => api.post<{ success: boolean; message: string }>(`/servers/${id}/test-ssh`),
  checkIp: (ip: string) => api.get<{ exists: boolean }>('/servers/check-ip', { params: { ip } }),
  destroyCredentials: (id: string) => api.post<{ success: boolean }>(`/servers/${id}/destroy-credentials`),
  restoreCredentials: (id: string, data: { sshAuth: string; sshAuthType: 'PASSWORD' | 'KEY' }) =>
    api.patch<{ success: boolean }>(`/servers/${id}/restore-credentials`, data),
};

// ── Nodes ─────────────────────────────────────────────
export const nodesApi = {
  listPresets: () => api.get<{ value: string; label: string; description: string; tags: { text: string; color: string }[] }[]>('/nodes/presets'),
  list: (serverId?: string) =>
    api.get<Node[]>('/nodes', { params: serverId ? { serverId } : {} }),
  get: (id: string) => api.get<Node>(`/nodes/${id}`),
  create: (data: CreateNodeDto) => api.post<Node>('/nodes', data),
  createFromPreset: (data: CreateNodeFromPresetDto) => api.post<Node>('/nodes/preset', data),
  update: (id: string, data: UpdateNodeDto) => api.patch<Node>(`/nodes/${id}`, data),
  rename: (id: string, name: string) => api.patch<Node>(`/nodes/${id}/rename`, { name }),
  delete: (id: string) => api.delete<void>(`/nodes/${id}`),
  toggle: (id: string) => api.patch<Node>(`/nodes/${id}/toggle`),
  credentials: (id: string) => api.get<Record<string, string>>(`/nodes/${id}/credentials`),
  deployLog: (id: string) => api.get<{ deployLog: string | null; version: number | null; createdAt: string | null }>(`/nodes/${id}/deploy-log`),
  shareLink: (id: string) => api.get<{ uri: string | null }>(`/nodes/${id}/share`),
  test: (id: string) => api.post<ConnectivityResult>(`/nodes/${id}/test`),
  deploy: (id: string) => api.post<void>(`/nodes/${id}/deploy`),
};

// ── Subscriptions ─────────────────────────────────────
export const subscriptionsApi = {
  list: () => api.get<Subscription[] | ViewerSubscriptionList>('/subscriptions'),
  create: (data: CreateSubscriptionDto) => api.post<Subscription>('/subscriptions', data),
  update: (id: string, data: UpdateSubscriptionDto) => api.patch<Subscription>(`/subscriptions/${id}`, data),
  refreshToken: (id: string) => api.post<{ id: string; token: string }>(`/subscriptions/${id}/refresh-token`),
  delete: (id: string) => api.delete<void>(`/subscriptions/${id}`),
  listShares: (id: string) => api.get<SubscriptionShare[]>(`/subscriptions/${id}/shares`),
  addShare: (id: string, userId: string) => api.post<SubscriptionShare>(`/subscriptions/${id}/shares`, { userId }),
  removeShare: (id: string, userId: string) => api.delete<void>(`/subscriptions/${id}/shares/${userId}`),
};

// ── IP Check ──────────────────────────────────────────
export const ipCheckApi = {
  get: (serverId: string) => api.get<ServerIpCheck | null>(`/ip-check/${serverId}`),
  trigger: (serverId: string) => api.post<{ ok: boolean }>(`/ip-check/${serverId}/trigger`),
  triggerGfw: (serverId: string) => api.post<{ ok: boolean }>(`/ip-check/${serverId}/gfw`),
};

// ── Metrics ───────────────────────────────────────────
export const metricsApi = {
  overview: () => api.get<Record<string, unknown>>('/metrics/overview'),
  server: (id: string, limit?: number) =>
    api.get<Metric[]>(`/metrics/servers/${id}`, { params: { limit } }),
};

// ── Audit ─────────────────────────────────────────────
export const auditApi = {
  list: (page = 1, pageSize = 20, action?: string) =>
    api.get<PaginatedResponse<AuditLog>>('/audit-logs', { params: { page, pageSize, action } }),
};

// ── OperationLogs ─────────────────────────────────────
export const operationLogsApi = {
  listByResource: (type: string, id: string) =>
    api.get<OperationLogEntry[]>(`/operation-logs/by-resource/${type}/${id}`),
  getByCorrelationId: (correlationId: string) =>
    api.get<OperationLogDetail | null>(`/operation-logs/by-correlation/${correlationId}`),
  getLog: (logId: string) => api.get<OperationLogDetail>(`/operation-logs/${logId}`),
};

// ── Users ─────────────────────────────────────────────
export const usersApi = {
  list: () => api.get<UserRecord[]>('/users'),
  listViewers: () => api.get<UserRecord[]>('/users/viewers'),
  updateRole: (id: string, role: string) => api.patch<UserRecord>(`/users/${id}/role`, { role }),
  remove: (id: string) => api.delete<void>(`/users/${id}`),
};

// ── InviteCodes ───────────────────────────────────────
export const inviteCodesApi = {
  list: () => api.get<InviteCode[]>('/invite-codes'),
  create: (quantity: number, maxUses: number) =>
    api.post<InviteCode[]>('/invite-codes', { quantity, maxUses }),
  createCustom: (customCode: string, maxUses: number) =>
    api.post<InviteCode[]>('/invite-codes', { quantity: 1, maxUses, customCode }),
  remove: (id: string) => api.delete<void>(`/invite-codes/${id}`),
};

// ── Agent ─────────────────────────────────────────────
export const agentApi = {
  latestVersion: () =>
    api.get<{ version: string; releaseNotes: string }>('/agent/latest-version'),
  update: (serverId: string) =>
    api.post<{ ok: boolean }>(`/servers/${serverId}/agent-update`),
  updateBatch: (ids: string[]) =>
    api.post<{ ok: boolean; count: number }>('/servers/agent-update-batch', { ids }),
};

// ── External Nodes ────────────────────────────────────
export const externalNodesApi = {
  list: () => api.get<ExternalNode[]>('/external-nodes'),
  import: (text: string) => api.post<{ success: number; failed: number; errors: string[] }>('/external-nodes/import', { text }),
  test: (id: string) => api.post<ConnectivityResult>(`/external-nodes/${id}/test`),
  remove: (id: string) => api.delete<void>(`/external-nodes/${id}`),
};

// ── WeChat Work ──────────────────────────────────────
export const wxWorkApi = {
  configured: () => api.get<{ configured: boolean }>('/auth/wxwork/configured'),
  loginUrl: (device: string, redirectUri?: string) =>
    api.get<{ url: string; state: string }>('/auth/wxwork/login-url', { params: { device, redirect_uri: redirectUri } }),
  callback: (code: string) =>
    api.post<{ accessToken: string; user: { id: string; username: string; role: string } }>('/auth/wxwork/callback', { code }),
  bind: (code: string) => api.post<{ bound: boolean; wxWorkName: string }>('/auth/wxwork/bind', { code }),
  unbind: () => api.delete<{ bound: boolean }>('/auth/wxwork/unbind'),
  bindStatus: () => api.get<{ bound: boolean; wxWorkName: string | null }>('/auth/wxwork/bind-status'),
  getSettings: () => api.get<WxWorkSetting | null>('/wxwork/settings'),
  upsertSettings: (data: UpsertWxWorkSettingDto) => api.put<WxWorkSetting>('/wxwork/settings', data),
  removeSettings: () => api.delete<void>('/wxwork/settings'),
};

// ── OpenRouter ───────────────────────────────────────
export const openRouterApi = {
  getSettings: () => api.get<OpenRouterSetting | null>('/openrouter/settings'),
  upsertSettings: (data: UpsertOpenRouterSettingDto) => api.put<OpenRouterSetting>('/openrouter/settings', data),
  removeSettings: () => api.delete<void>('/openrouter/settings'),
  listModels: () => api.get<{ id: string; name: string; promptPrice: string; completionPrice: string }[]>('/openrouter/models'),
  test: (model?: string) => api.post<{ success: boolean; message: string }>('/openrouter/test', { model }),
};

// ── Recommends ───────────────────────────────────────
export const recommendsApi = {
  list: () => api.get<ServerRecommendCategory[]>('/recommends'),
  createCategory: (data: { name: string; description?: string; sortOrder?: number }) => api.post('/recommends/categories', data),
  updateCategory: (id: string, data: { name?: string; description?: string; sortOrder?: number }) => api.patch(`/recommends/categories/${id}`, data),
  removeCategory: (id: string) => api.delete(`/recommends/categories/${id}`),
  extract: (url: string) => api.post<ExtractResult>('/recommends/extract', { url }),
  create: (data: { categoryIds: string[]; name: string; price: string; regions: string[]; link: string; sortOrder?: number }) => api.post('/recommends', data),
  update: (id: string, data: { name?: string; price?: string; regions?: string[]; link?: string; categoryIds?: string[]; sortOrder?: number }) => api.patch(`/recommends/${id}`, data),
  remove: (id: string) => api.delete(`/recommends/${id}`),
};

// ── Cloudflare ────────────────────────────────────────
export const cloudflareApi = {
  get: () => api.get<CloudflareSetting | null>('/cloudflare/settings'),
  upsert: (data: UpsertCloudflareSettingDto) => api.put<CloudflareSetting>('/cloudflare/settings', data),
  remove: () => api.delete<void>('/cloudflare/settings'),
  verify: () => api.get<{ valid: boolean; zoneName?: string; zoneStatus?: string; message: string }>('/cloudflare/settings/verify'),
};
