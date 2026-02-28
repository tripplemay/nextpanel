import axios from 'axios';
import type {
  Server,
  Node,
  Pipeline,
  Template,
  Subscription,
  GithubConfig,
  Metric,
  ConnectivityResult,
  PaginatedResponse,
  AuditLog,
  CreateServerDto,
  UpdateServerDto,
  CreateNodeDto,
  UpdateNodeDto,
  CreatePipelineDto,
  UpdatePipelineDto,
  CreateTemplateDto,
  UpdateTemplateDto,
  CreateSubscriptionDto,
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
    if (error.response?.status === 401 && typeof window !== 'undefined') {
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
};

// ── Nodes ─────────────────────────────────────────────
export const nodesApi = {
  list: (serverId?: string) =>
    api.get<Node[]>('/nodes', { params: serverId ? { serverId } : {} }),
  get: (id: string) => api.get<Node>(`/nodes/${id}`),
  create: (data: CreateNodeDto) => api.post<Node>('/nodes', data),
  update: (id: string, data: UpdateNodeDto) => api.patch<Node>(`/nodes/${id}`, data),
  delete: (id: string) => api.delete<void>(`/nodes/${id}`),
  test: (id: string) => api.post<ConnectivityResult>(`/nodes/${id}/test`),
  deploy: (id: string) => api.post<void>(`/nodes/${id}/deploy`),
};

// ── Templates ─────────────────────────────────────────
export const templatesApi = {
  list: () => api.get<Template[]>('/templates'),
  get: (id: string) => api.get<Template>(`/templates/${id}`),
  create: (data: CreateTemplateDto) => api.post<Template>('/templates', data),
  update: (id: string, data: UpdateTemplateDto) => api.patch<Template>(`/templates/${id}`, data),
  delete: (id: string) => api.delete<void>(`/templates/${id}`),
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
  list: (page = 1, pageSize = 20) =>
    api.get<PaginatedResponse<AuditLog>>('/audit-logs', { params: { page, pageSize } }),
};

// ── Pipelines (GitHub Actions deploy configs) ──────────
export const pipelinesApi = {
  list: () => api.get<Pipeline[]>('/pipelines'),
  get: (id: string) => api.get<Pipeline>(`/pipelines/${id}`),
  create: (data: CreatePipelineDto) => api.post<Pipeline>('/pipelines', data),
  update: (id: string, data: UpdatePipelineDto) => api.patch<Pipeline>(`/pipelines/${id}`, data),
  delete: (id: string) => api.delete<void>(`/pipelines/${id}`),
  githubConfig: (id: string) => api.get<GithubConfig>(`/pipelines/${id}/github-config`),
};
