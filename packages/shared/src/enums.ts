export enum Protocol {
  VMESS = 'vmess',
  VLESS = 'vless',
  TROJAN = 'trojan',
  SHADOWSOCKS = 'shadowsocks',
  SOCKS5 = 'socks5',
  HTTP = 'http',
}

export enum Implementation {
  XRAY = 'xray',
  V2RAY = 'v2ray',
  SING_BOX = 'sing-box',
  SS_LIBEV = 'ss-libev',
}

export enum Transport {
  TCP = 'tcp',
  WS = 'ws',
  GRPC = 'grpc',
  QUIC = 'quic',
}

export enum TlsMode {
  NONE = 'none',
  TLS = 'tls',
  REALITY = 'reality',
}

export enum ServerStatus {
  UNKNOWN = 'unknown',
  ONLINE = 'online',
  OFFLINE = 'offline',
  ERROR = 'error',
}

export enum NodeStatus {
  INACTIVE = 'inactive',
  RUNNING = 'running',
  STOPPED = 'stopped',
  ERROR = 'error',
}

export enum ReleaseStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED = 'failed',
  ROLLED_BACK = 'rolled_back',
}

export enum ReleaseStrategy {
  SINGLE = 'single',
  BATCH = 'batch',
  CANARY = 'canary',
}

export enum ReleaseStepStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

export enum AuditAction {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LOGIN = 'login',
  LOGOUT = 'logout',
  DEPLOY = 'deploy',
  ROLLBACK = 'rollback',
  SSH_TEST = 'ssh_test',
}

export enum UserRole {
  ADMIN = 'admin',
  OPERATOR = 'operator',
  VIEWER = 'viewer',
}
