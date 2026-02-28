import axios from 'axios';

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
    api.post('/auth/login', { username, password }),
};

// ── Servers ──────────────────────────────────────────
export const serversApi = {
  list: () => api.get('/servers'),
  get: (id: string) => api.get(`/servers/${id}`),
  create: (data: unknown) => api.post('/servers', data),
  update: (id: string, data: unknown) => api.patch(`/servers/${id}`, data),
  delete: (id: string) => api.delete(`/servers/${id}`),
  testSsh: (id: string) => api.post(`/servers/${id}/test-ssh`),
};

// ── Nodes ─────────────────────────────────────────────
export const nodesApi = {
  list: (serverId?: string) =>
    api.get('/nodes', { params: serverId ? { serverId } : {} }),
  get: (id: string) => api.get(`/nodes/${id}`),
  create: (data: unknown) => api.post('/nodes', data),
  update: (id: string, data: unknown) => api.patch(`/nodes/${id}`, data),
  delete: (id: string) => api.delete(`/nodes/${id}`),
  test: (id: string) => api.post(`/nodes/${id}/test`),
  deploy: (id: string) => api.post(`/nodes/${id}/deploy`),
};

// ── Templates ─────────────────────────────────────────
export const templatesApi = {
  list: () => api.get('/templates'),
  get: (id: string) => api.get(`/templates/${id}`),
  create: (data: unknown) => api.post('/templates', data),
  update: (id: string, data: unknown) => api.patch(`/templates/${id}`, data),
  delete: (id: string) => api.delete(`/templates/${id}`),
};

// ── Subscriptions ─────────────────────────────────────
export const subscriptionsApi = {
  list: () => api.get('/subscriptions'),
  create: (data: unknown) => api.post('/subscriptions', data),
  delete: (id: string) => api.delete(`/subscriptions/${id}`),
};

// ── Metrics ───────────────────────────────────────────
export const metricsApi = {
  overview: () => api.get('/metrics/overview'),
  server: (id: string, limit?: number) =>
    api.get(`/metrics/servers/${id}`, { params: { limit } }),
};

// ── Audit ─────────────────────────────────────────────
export const auditApi = {
  list: (page = 1, pageSize = 20) =>
    api.get('/audit-logs', { params: { page, pageSize } }),
};

// ── Pipelines (GitHub Actions deploy configs) ──────────
export const pipelinesApi = {
  list: () => api.get('/pipelines'),
  get: (id: string) => api.get(`/pipelines/${id}`),
  create: (data: unknown) => api.post('/pipelines', data),
  update: (id: string, data: unknown) => api.patch(`/pipelines/${id}`, data),
  delete: (id: string) => api.delete(`/pipelines/${id}`),
  githubConfig: (id: string) => api.get(`/pipelines/${id}/github-config`),
};
