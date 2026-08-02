import { isIP } from 'net';
import { domainToASCII } from 'url';

const MAX_URI_LENGTH = 4096;
const MAX_LABEL_LENGTH = 128;

export interface Socks5ExitConfig {
  version: 5;
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface ParsedSocksUri {
  config: Socks5ExitConfig;
  name: string;
}

export class SocksUriParseError extends Error {}

export function parseSocksUri(value: string): ParsedSocksUri {
  const uri = value.trim();
  if (!uri || uri.length > MAX_URI_LENGTH || hasControlCharacters(uri)) {
    throw new SocksUriParseError('SOCKS 地址为空、过长或包含控制字符');
  }

  const schemeMatch = /^(socks|socks5):\/\//i.exec(uri);
  if (!schemeMatch) {
    throw new SocksUriParseError('仅支持 socks:// 或 socks5:// 地址');
  }

  const withoutScheme = uri.slice(schemeMatch[0].length);
  const hashIndex = withoutScheme.indexOf('#');
  const authority = hashIndex >= 0 ? withoutScheme.slice(0, hashIndex) : withoutScheme;
  const fragment = hashIndex >= 0 ? withoutScheme.slice(hashIndex + 1) : '';
  if (!authority) throw new SocksUriParseError('SOCKS 地址缺少主机和端口');

  const atIndex = authority.lastIndexOf('@');
  const userInfo = atIndex >= 0 ? authority.slice(0, atIndex) : '';
  const hostPort = atIndex >= 0 ? authority.slice(atIndex + 1) : authority;
  if (/[/?#]/.test(hostPort)) {
    throw new SocksUriParseError('SOCKS 地址不能包含路径或查询参数');
  }
  const { host, port } = parseHostPort(hostPort);
  const credentials = userInfo ? parseCredentials(userInfo) : {};
  const decodedLabel = fragment ? decodeComponent(fragment, 'SOCKS 备注') : '';
  if (decodedLabel.length > MAX_LABEL_LENGTH || hasControlCharacters(decodedLabel)) {
    throw new SocksUriParseError(`SOCKS 备注不能超过 ${MAX_LABEL_LENGTH} 个字符或包含控制字符`);
  }

  return {
    config: {
      version: 5,
      host,
      port,
      ...credentials,
    },
    name: decodedLabel || `SOCKS5 ${formatHost(host)}:${port}`,
  };
}

export function parseStoredSocksExit(value: string): Socks5ExitConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Stored SOCKS5 exit configuration is invalid');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Stored SOCKS5 exit configuration is invalid');
  }
  const record = parsed as Record<string, unknown>;
  const username = typeof record.username === 'string' ? record.username : undefined;
  const password = typeof record.password === 'string' ? record.password : undefined;
  if (
    record.version !== 5
    || typeof record.host !== 'string'
    || typeof record.port !== 'number'
    || !Number.isInteger(record.port)
    || record.port < 1
    || record.port > 65535
    || (username === undefined) !== (password === undefined)
  ) {
    throw new Error('Stored SOCKS5 exit configuration is invalid');
  }
  return {
    version: 5,
    host: record.host,
    port: record.port,
    ...(username !== undefined ? { username, password } : {}),
  };
}

function parseHostPort(value: string): { host: string; port: number } {
  let rawHost: string;
  let rawPort: string;
  if (value.startsWith('[')) {
    const closeIndex = value.indexOf(']');
    if (closeIndex <= 1 || value[closeIndex + 1] !== ':') {
      throw new SocksUriParseError('IPv6 SOCKS 地址必须使用 [host]:port 格式');
    }
    rawHost = value.slice(1, closeIndex);
    rawPort = value.slice(closeIndex + 2);
  } else {
    const colonIndex = value.lastIndexOf(':');
    if (colonIndex <= 0) throw new SocksUriParseError('SOCKS 地址缺少端口');
    rawHost = value.slice(0, colonIndex);
    rawPort = value.slice(colonIndex + 1);
  }

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new SocksUriParseError('SOCKS 端口必须在 1-65535 之间');
  }
  if (!rawHost || rawHost.length > 253 || /[\s/?#@\[\]]/.test(rawHost)) {
    throw new SocksUriParseError('SOCKS 主机名无效');
  }

  if (rawHost.includes(':')) {
    if (isIP(rawHost) !== 6) throw new SocksUriParseError('SOCKS IPv6 地址无效');
    return { host: rawHost, port };
  }

  const host = isIP(rawHost) === 4 ? rawHost : domainToASCII(rawHost);
  if (!host || host.length > 253) throw new SocksUriParseError('SOCKS 主机名无效');
  return { host, port };
}

function parseCredentials(userInfo: string): { username: string; password: string } {
  const literalColon = userInfo.indexOf(':');
  let username: string;
  let password: string;

  if (literalColon >= 0) {
    username = decodeComponent(userInfo.slice(0, literalColon), 'SOCKS 用户名');
    password = decodeComponent(userInfo.slice(literalColon + 1), 'SOCKS 密码');
  } else {
    const decodedUserInfo = decodeComponent(userInfo, 'SOCKS 认证信息');
    const decodedBase64 = decodeBase64Credentials(decodedUserInfo);
    const colonIndex = decodedBase64.indexOf(':');
    if (colonIndex < 1) {
      throw new SocksUriParseError('Base64 SOCKS 认证信息必须为 username:password');
    }
    username = decodedBase64.slice(0, colonIndex);
    password = decodedBase64.slice(colonIndex + 1);
  }

  if (!username || username.length > 256 || password.length > 1024) {
    throw new SocksUriParseError('SOCKS 用户名为空或认证信息过长');
  }
  if (hasControlCharacters(username) || hasControlCharacters(password)) {
    throw new SocksUriParseError('SOCKS 认证信息包含控制字符');
  }
  return { username, password };
}

function decodeBase64Credentials(value: string): string {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) {
    throw new SocksUriParseError('SOCKS Base64 认证信息格式无效');
  }
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  try {
    const bytes = Buffer.from(padded, 'base64');
    if (!bytes.length || bytes.toString('base64').replace(/=+$/, '') !== normalized) {
      throw new Error('invalid base64');
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new SocksUriParseError('SOCKS Base64 认证信息格式无效');
  }
}

function decodeComponent(value: string, label: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new SocksUriParseError(`${label}的 URL 编码无效`);
  }
}

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function formatHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}
