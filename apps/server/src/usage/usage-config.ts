import { LEGACY_EMAIL, USAGE_LIMIT } from './usage.util';

export interface UsageUser { id: string; email: string; level?: number }
export function usageStagingPaths(configPath: string, nonce: string) {
  const stem = `${configPath}.usage-${nonce}`;
  return { stage: `${stem}.json`, backup: `${stem}.backup`, additions: `${stem}.add.json` };
}
type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_CONFIG');
  return value as JsonObject;
};

export function usageConfig(raw: string, nodeId: string, statsPort: number, users: UsageUser[]) {
  if (users.length > USAGE_LIMIT) throw new Error('CREDENTIAL_LIMIT');
  const config = object(JSON.parse(raw));
  if (!Array.isArray(config.inbounds)) throw new Error('INVALID_CONFIG');
  const inbound = config.inbounds.map(object).find(i => i.tag === `in-${nodeId}`);
  const apiInbound = config.inbounds.map(object).find(i => i.tag === 'api');
  if (!inbound || inbound.protocol !== 'vless' || object(inbound.streamSettings).network !== 'ws'
    || object(inbound.streamSettings).security !== 'tls' || !apiInbound || apiInbound.listen !== '127.0.0.1'
    || apiInbound.port !== statsPort) throw new Error('UNSUPPORTED_CONFIG');
  const settings = object(inbound.settings);
  if (!Array.isArray(settings.clients)) throw new Error('INVALID_CONFIG');
  const legacy = settings.clients.map(object).filter(u => !String(u.email ?? '').startsWith('np-usage-'));
  if (legacy.length !== 1 || (legacy[0].email && legacy[0].email !== LEGACY_EMAIL)) throw new Error('UNSUPPORTED_CONFIG');
  const api = object(config.api);
  if (!Array.isArray(api.services) || !api.services.includes('StatsService')) throw new Error('UNSUPPORTED_CONFIG');
  const policy = object(config.policy ?? {});
  const levels = object(policy.levels ?? {});
  const level = object(levels['4242'] ?? {});
  const prepared = api.services.includes('HandlerService') && level.statsUserUplink === true && level.statsUserDownlink === true
    && legacy[0].email === LEGACY_EMAIL && legacy[0].level === 4242;
  if (!prepared && levels['4242']) throw new Error('RESERVED_LEVEL_CONFLICT');
  settings.clients = [{ ...legacy[0], email: LEGACY_EMAIL, level: 4242 }, ...users.map(u => ({ ...u, level: 4242 }))];
  api.services = [...new Set([...api.services, 'HandlerService'])];
  config.stats = config.stats ?? {};
  policy.levels = { ...levels, '4242': { ...object(levels[String(legacy[0].level ?? 0)] ?? {}), ...level, statsUserUplink: true, statsUserDownlink: true } };
  config.policy = policy;
  return { config: JSON.stringify(config, null, 2), prepared };
}

export function runtimeUsers(raw: string): Map<string, string> {
  const data = object(JSON.parse(raw));
  const users = data.users ?? [];
  if (!Array.isArray(users) || users.length > USAGE_LIMIT + 1) throw new Error('INVALID_RUNTIME_USERS');
  const result = new Map<string, string>();
  for (const item of users) {
    const user = object(item);
    if (typeof user.email !== 'string' || !user.email || result.has(user.email)) throw new Error('INVALID_RUNTIME_USERS');
    const account = object(user.account);
    if (typeof account.id !== 'string' || !account.id) throw new Error('INVALID_RUNTIME_USERS');
    result.set(user.email, account.id);
  }
  return result;
}
