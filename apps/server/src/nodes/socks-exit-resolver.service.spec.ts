import {
  buildSocksExitProbeConfig,
  SocksExitResolverService,
} from './socks-exit-resolver.service';

describe('SocksExitResolverService', () => {
  const service = new SocksExitResolverService();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns a literal IP without performing DNS queries', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');

    await expect(service.resolve('203.0.113.8', ['192.0.2.1'])).resolves.toEqual({
      candidates: [{ address: '203.0.113.8', sources: ['SOCKS URI'] }],
      warnings: [],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('merges entry-system and controlled ECS answers in deterministic order', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      const type = url.searchParams.get('type');
      const ecs = url.searchParams.get('edns_client_subnet');
      const answers = type === 'AAAA'
        ? [{ type: 28, data: '2001:db8::8' }]
        : ecs === '223.5.5.5/24'
          ? [{ type: 1, data: '119.147.134.162' }]
          : ecs === '114.114.114.114/24'
            ? [{ type: 1, data: '120.232.208.178' }]
            : [
                { type: 5, data: 'ignored.example.com.' },
                { type: 1, data: '1.1.1.1' },
              ];
      return {
        ok: true,
        status: 200,
        json: async () => ({ Status: 0, Answer: answers }),
      } as Response;
    });

    const result = await service.resolve('proxy.example.com', ['1.1.1.1', '1.1.1.1']);

    expect(result.warnings).toEqual([]);
    expect(result.candidates.map((candidate) => candidate.address)).toEqual([
      '1.1.1.1',
      '119.147.134.162',
      '120.232.208.178',
      '2001:db8::8',
    ]);
    expect(result.candidates[0].sources).toEqual(['入口系统 DNS', 'Google DoH']);
  });

  it('keeps available candidates when controlled DNS queries fail', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network unavailable'));

    const result = await service.resolve('proxy.example.com', ['192.0.2.10']);

    expect(result.candidates).toEqual([
      { address: '192.0.2.10', sources: ['入口系统 DNS'] },
    ]);
    expect(result.warnings).toHaveLength(6);
  });

  it('returns no candidates when every resolver fails', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network unavailable'));

    const result = await service.resolve('proxy.example.com', []);

    expect(result.candidates).toEqual([]);
    expect(result.warnings).toHaveLength(6);
  });
});

describe('buildSocksExitProbeConfig', () => {
  const socks = {
    version: 5 as const,
    host: 'proxy.example.com',
    port: 1080,
    username: 'user',
    password: 'pass',
  };

  it('builds an Xray probe pinned to the candidate IP', () => {
    const config = JSON.parse(
      buildSocksExitProbeConfig('XRAY', socks, '203.0.113.10', 30001),
    );

    expect(config.inbounds[0]).toMatchObject({ listen: '127.0.0.1', port: 30001 });
    expect(config.outbounds[0]).toMatchObject({
      protocol: 'socks',
      settings: {
        address: '203.0.113.10',
        port: 1080,
        user: 'user',
        pass: 'pass',
      },
    });
  });

  it('builds a sing-box probe pinned to the candidate IP', () => {
    const config = JSON.parse(
      buildSocksExitProbeConfig('SING_BOX', socks, '2001:db8::10', 30002),
    );

    expect(config.inbounds[0]).toMatchObject({ listen: '127.0.0.1', listen_port: 30002 });
    expect(config.outbounds[0]).toMatchObject({
      type: 'socks',
      server: '2001:db8::10',
      server_port: 1080,
      username: 'user',
      password: 'pass',
    });
  });
});
