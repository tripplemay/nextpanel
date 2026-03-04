import { SingboxTestService } from './singbox-test.service';

describe('SingboxTestService', () => {
  let service: SingboxTestService;

  beforeEach(() => {
    service = new SingboxTestService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('buildClientConfig (via testHysteria2 path)', () => {
    it('builds config with password and insecure TLS', async () => {
      // Access private method via cast for unit testing
      const svc = service as unknown as {
        buildClientConfig(
          node: { host: string; port: number; domain: string | null; credentials: Record<string, string> },
          socksPort: number,
        ): unknown;
      };

      const cfg = svc.buildClientConfig(
        { host: '1.2.3.4', port: 8443, domain: null, credentials: { password: 'secret' } },
        30100,
      ) as {
        log: unknown;
        inbounds: Array<{ type: string; listen: string; listen_port: number }>;
        outbounds: Array<{ type: string; server: string; server_port: number; password: string; tls: Record<string, unknown> }>;
      };

      expect(cfg.inbounds[0]).toMatchObject({
        type: 'socks',
        listen: '127.0.0.1',
        listen_port: 30100,
      });

      expect(cfg.outbounds[0]).toMatchObject({
        type: 'hysteria2',
        server: '1.2.3.4',
        server_port: 8443,
        password: 'secret',
        tls: { enabled: true, insecure: true },
      });

      // No server_name when domain is null
      expect(cfg.outbounds[0].tls).not.toHaveProperty('server_name');
    });

    it('includes server_name when domain is provided', () => {
      const svc = service as unknown as {
        buildClientConfig(
          node: { host: string; port: number; domain: string | null; credentials: Record<string, string> },
          socksPort: number,
        ): unknown;
      };

      const cfg = svc.buildClientConfig(
        { host: '1.2.3.4', port: 8443, domain: 'example.com', credentials: { password: 'pass' } },
        30200,
      ) as {
        outbounds: Array<{ tls: Record<string, unknown> }>;
      };

      expect(cfg.outbounds[0].tls).toMatchObject({
        enabled: true,
        insecure: true,
        server_name: 'example.com',
      });
    });

    it('falls back to empty string when password credential is missing', () => {
      const svc = service as unknown as {
        buildClientConfig(
          node: { host: string; port: number; domain: string | null; credentials: Record<string, string> },
          socksPort: number,
        ): unknown;
      };

      const cfg = svc.buildClientConfig(
        { host: '1.2.3.4', port: 8443, domain: null, credentials: {} },
        30300,
      ) as {
        outbounds: Array<{ password: string }>;
      };

      expect(cfg.outbounds[0].password).toBe('');
    });
  });
});
