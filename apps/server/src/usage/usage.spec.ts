import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { HeartbeatDto } from '../agent/heartbeat.dto';
import { candidateKey, counterDelta, grantVersion, usageEligible, usageStatus } from './usage.util';
import { runtimeUsers, usageConfig } from './usage-config';
import { generateXrayConfig } from '../nodes/config/xray-config';
import { UsageService } from './usage.service';
import type { NodeExportInfo } from '../subscriptions/uri-builder';

const node = { id: 'fixture', protocol: 'VLESS', implementation: 'XRAY', transport: 'WS', tls: 'TLS', listenPort: 443, domain: 'cdn.example.com', statsPort: 20443, cfDnsRecordId: 'record' };
const candidate: NodeExportInfo = { name: 'candidate 1', protocol: 'VLESS', transport: 'WS', tls: 'TLS', host: '104.16.0.1', port: 443, domain: 'cdn.example.com', cfCarrier: 'GENERIC', credentials: { uuid: 'fixture' } };
describe('server usage evidence boundaries', () => {
  it('keeps ingestion bounded and off the ordinary heartbeat response path', async () => {
    const service = new UsageService({} as never, {} as never);
    jest.spyOn(service, 'enabled').mockReturnValue(true);
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const ingest = jest.spyOn(service, 'ingest').mockReturnValue(pending);
    for (let i = 0; i < 10; i++) service.enqueue(`s${i}`, []);
    service.enqueue('s0', []);
    expect(ingest).toHaveBeenCalledTimes(8);
    release();
    await new Promise(resolve => setImmediate(resolve));
    service.enqueue('s0', []);
    expect(ingest).toHaveBeenCalledTimes(9);
  });
  it('does not confuse a reused label with a candidate identity', () => {
    expect(candidateKey(candidate)).toBe(candidateKey({ ...candidate, name: 'renamed' }));
    expect(candidateKey(candidate)).not.toBe(candidateKey({ ...candidate, host: '104.16.0.2' }));
    expect(candidateKey(candidate)).not.toBe(candidateKey({ ...candidate, credentials: { uuid: 'rotated' } }));
    expect(() => candidateKey({ ...candidate, host: 'origin.example.com' })).toThrow();
    expect(grantVersion('one')).not.toBe(grantVersion('two'));
  });
  it('restricts observation to compatible managed CDN nodes', () => {
    expect(usageEligible(node)).toBe(true);
    for (const change of [{ implementation: 'SING_BOX' }, { transport: 'TCP' }, { tls: 'REALITY' }, { cfDnsRecordId: null }]) expect(usageEligible({ ...node, ...change })).toBe(false);
  });
  it('never reports a stale or first sample as activity or a measured zero', () => {
    const now = 1_000_000;
    expect(usageStatus(null, null, false, now)).toBe('PENDING');
    expect(usageStatus(new Date(now - 91_000), new Date(now), true, now)).toBe('STALE');
    expect(usageStatus(new Date(now), null, true, now)).toBe('IDLE');
    expect(usageStatus(new Date(now), new Date(now - 10_000), true, now)).toBe('ACTIVE');
    expect(counterDelta(200n, 100n, 10, false)).toEqual({ bytes: 100n, rate: 10 });
    for (const [seconds, reset, current] of [[0, false, 200n], [100, false, 200n], [10, true, 200n], [10, false, 50n]] as const) expect(counterDelta(current, 100n, seconds, reset)).toEqual({ bytes: 0n, rate: null });
  });
  it('preserves CDN transport, origin credential, routing, and statistics binding', () => {
    const original = generateXrayConfig(node, { uuid: 'legacy' });
    const users = [{ email: 'np-usage-fixture', id: 'new' }];
    const result = usageConfig(original, node.id, node.statsPort, users);
    expect(result.prepared).toBe(false);
    const before = JSON.parse(original); const after = JSON.parse(result.config);
    expect(after.inbounds[1].streamSettings).toEqual(before.inbounds[1].streamSettings);
    expect(after.inbounds[0]).toEqual(before.inbounds[0]);
    expect(after.routing).toEqual(before.routing);
    expect(after.outbounds).toEqual(before.outbounds);
    expect(after.inbounds[1].settings.clients[0]).toMatchObject({ id: 'legacy', email: 'np-legacy' });
    expect(after.inbounds[1].settings.clients[1]).toMatchObject({ id: 'new', email: 'np-usage-fixture' });
    expect(usageConfig(result.config, node.id, node.statsPort, users)).toEqual({ config: result.config, prepared: true });
    expect(JSON.parse(generateXrayConfig({ ...node, usageUsers: users }, { uuid: 'legacy' })).inbounds[1].settings.clients).toEqual(after.inbounds[1].settings.clients);
    expect(() => usageConfig(original, 'foreign', node.statsPort, users)).toThrow();
    before.inbounds[0].listen = '0.0.0.0';
    expect(() => usageConfig(JSON.stringify(before), node.id, node.statsPort, users)).toThrow();
  });
  it('validates exact runtime credential rather than accepting an API exit code', () => {
    expect(runtimeUsers('{"users":[{"email":"np-usage-a","account":{"id":"uuid"}}]}').get('np-usage-a')).toBe('uuid');
    expect(() => runtimeUsers('{"users":[{"email":"np-usage-a","account":{}}]}')).toThrow();
    expect(() => runtimeUsers('{"users":[{"email":"np-usage-a","account":{"id":"one"}},{"email":"np-usage-a","account":{"id":"two"}}]}')).toThrow();
  });
  it('rejects destination data, oversized counters, duplicate-free names and unknown fields at the ingestion boundary', async () => {
    const payload = { agentToken: 'fixture', agentVersion: '1.8.0', cpu: 1, mem: 1, disk: 1, networkIn: 0, networkOut: 0,
      usageSamples: [{ nodeId: 'n', sampleId: 'sample', sampledAt: new Date().toISOString(), uptime: 1,
        users: [{ email: 'np-usage-a', upBytes: '0', downBytes: '200' }] }] };
    expect(await validate(plainToInstance(HeartbeatDto, payload), { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    for (const changed of [{ ...payload.usageSamples[0].users[0], domain: 'private.example' },
      { ...payload.usageSamples[0].users[0], upBytes: '-1' }, { ...payload.usageSamples[0].users[0], email: 'person@example.com' },
      { ...payload.usageSamples[0].users[0], downBytes: '999999999999999999999999' }]) {
      const result = await validate(plainToInstance(HeartbeatDto, { ...payload, usageSamples: [{ ...payload.usageSamples[0], users: [changed] }] }), { whitelist: true, forbidNonWhitelisted: true });
      expect(result.length).toBeGreaterThan(0);
    }
  });
});
