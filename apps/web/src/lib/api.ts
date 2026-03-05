import axios from 'axios';
import type {
  Server,
  Node,
  Subscription,
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
  UpsertCloudflareSettingDto,
} from '@/types/api';

export const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
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
      localStorage.removeItem('access_token');
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
};

// ── Servers ──────────────────────────────────────────
export const serversApi = {
  list: () => api.get<Server[]>('/servers'),
  get: (id: string) => api.get<Server>(`/servers/${id}`),
  create: (data: CreateServerDto) => api.post<Server>('/servers', data),
  update: (id: string, data: UpdateServerDto) => api.patch<Server>(`/servers/${id}`, data),
  delete: (id: string) => api.delete<void>(`/servers/${id}`),
  testSsh: (id: string) => api.post<{ success: boolean; message: string }>(`/servers/${id}/test-ssh`),
  checkIp: (ip: string) => api.get<{ exists: boolean }>('/servers/check-ip', { params: { ip } }),
};

// ── Nodes ─────────────────────────────────────────────
export const nodesApi = {
  listPresets: () => api.get<{ value: string; label: string; description: string }[]>('/nodes/presets'),
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
  list: () => api.get<Subscription[]>('/subscriptions'),
  create: (data: CreateSubscriptionDto) => api.post<Subscription>('/subscriptions', data),
  delete: (id: string) => api.delete<void>(`/subscriptions/${id}`),
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

// ── Cloudflare ────────────────────────────────────────
export const cloudflareApi = {
  get: () => api.get<CloudflareSetting | null>('/cloudflare/settings'),
  upsert: (data: UpsertCloudflareSettingDto) => api.put<CloudflareSetting>('/cloudflare/settings', data),
  remove: () => api.delete<void>('/cloudflare/settings'),
  verify: () => api.get<{ valid: boolean; zoneName?: string; zoneStatus?: string; message: string }>('/cloudflare/settings/verify'),
};
