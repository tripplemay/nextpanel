import { CertRenewalScheduler } from './cert-renewal.scheduler';
import { PrismaService } from '../prisma.service';
import { CertService } from '../common/cert/cert.service';
import { CloudflareSettingsService } from '../cloudflare/cloudflare-settings.service';
import { NodeDeployService } from './node-deploy.service';

describe('CertRenewalScheduler', () => {
  const prisma = {
    node: { findMany: jest.fn() },
  } as unknown as PrismaService;
  const certService = {
    renewWildcardCert: jest.fn(),
  } as unknown as CertService;
  const cfSettings = {
    getDecryptedToken: jest.fn(),
  } as unknown as CloudflareSettingsService;
  const nodeDeploy = {
    refreshCert: jest.fn(),
  } as unknown as NodeDeployService;

  let scheduler: CertRenewalScheduler;

  beforeEach(() => {
    jest.clearAllMocks();
    scheduler = new CertRenewalScheduler(
      prisma,
      certService,
      cfSettings,
      nodeDeploy,
    );
  });

  it('queries TCP TLS, TUIC, and AnyTLS managed-certificate nodes', async () => {
    (prisma.node.findMany as jest.Mock).mockResolvedValue([]);

    await scheduler.renewExpiredCerts();

    expect(prisma.node.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        tls: 'TLS',
        source: 'AUTO',
        OR: [
          { transport: 'TCP' },
          { protocol: { in: ['TUIC', 'ANYTLS'] } },
        ],
      }),
      select: { id: true, userId: true, domain: true },
    });
  });

  it('renews a shared wildcard once and refreshes every affected node', async () => {
    (prisma.node.findMany as jest.Mock).mockResolvedValue([
      { id: 'tuic-1', userId: 'user-1', domain: 'a.example.com' },
      { id: 'anytls-1', userId: 'user-1', domain: 'b.example.com' },
    ]);
    (cfSettings.getDecryptedToken as jest.Mock).mockResolvedValue({
      apiToken: 'cf-token',
    });
    (certService.renewWildcardCert as jest.Mock).mockResolvedValue(true);
    (nodeDeploy.refreshCert as jest.Mock).mockResolvedValue(undefined);

    await scheduler.renewExpiredCerts();

    expect(certService.renewWildcardCert).toHaveBeenCalledTimes(1);
    expect(certService.renewWildcardCert).toHaveBeenCalledWith(
      'cf-token',
      'example.com',
      expect.any(Function),
    );
    expect(nodeDeploy.refreshCert).toHaveBeenCalledTimes(2);
    expect(nodeDeploy.refreshCert).toHaveBeenCalledWith('tuic-1');
    expect(nodeDeploy.refreshCert).toHaveBeenCalledWith('anytls-1');
  });

  it('skips renewal when Cloudflare settings are missing', async () => {
    (prisma.node.findMany as jest.Mock).mockResolvedValue([
      { id: 'tuic-1', userId: 'user-1', domain: 'a.example.com' },
    ]);
    (cfSettings.getDecryptedToken as jest.Mock).mockResolvedValue(null);

    await scheduler.renewExpiredCerts();

    expect(certService.renewWildcardCert).not.toHaveBeenCalled();
    expect(nodeDeploy.refreshCert).not.toHaveBeenCalled();
  });

  it('syncs the current certificate even when no renewal was needed', async () => {
    (prisma.node.findMany as jest.Mock).mockResolvedValue([
      { id: 'tuic-1', userId: 'user-1', domain: 'a.example.com' },
    ]);
    (cfSettings.getDecryptedToken as jest.Mock).mockResolvedValue({ apiToken: 'cf-token' });
    (certService.renewWildcardCert as jest.Mock).mockResolvedValue(false);
    (nodeDeploy.refreshCert as jest.Mock).mockResolvedValue(undefined);

    await scheduler.renewExpiredCerts();

    expect(nodeDeploy.refreshCert).toHaveBeenCalledWith('tuic-1');
  });

  it('continues syncing sibling nodes after one push fails', async () => {
    (prisma.node.findMany as jest.Mock).mockResolvedValue([
      { id: 'tuic-1', userId: 'user-1', domain: 'a.example.com' },
      { id: 'anytls-1', userId: 'user-1', domain: 'b.example.com' },
    ]);
    (cfSettings.getDecryptedToken as jest.Mock).mockResolvedValue({ apiToken: 'cf-token' });
    (certService.renewWildcardCert as jest.Mock).mockResolvedValue(false);
    (nodeDeploy.refreshCert as jest.Mock)
      .mockRejectedValueOnce(new Error('SSH unavailable'))
      .mockResolvedValueOnce(undefined);

    await scheduler.renewExpiredCerts();

    expect(certService.renewWildcardCert).toHaveBeenCalledTimes(1);
    expect(nodeDeploy.refreshCert).toHaveBeenCalledTimes(2);
    expect(nodeDeploy.refreshCert).toHaveBeenLastCalledWith('anytls-1');
  });
});
