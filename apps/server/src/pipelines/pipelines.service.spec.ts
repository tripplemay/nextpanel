import { PipelinesService } from './pipelines.service';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { NotFoundException } from '@nestjs/common';

const mockPrisma = {
  pipeline: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  server: {
    findMany: jest.fn(),
  },
} as unknown as PrismaService;

const mockCrypto = {
  encrypt: jest.fn((s: string) => `enc:${s}`),
  decrypt: jest.fn((s: string) => s.replace('enc:', '')),
} as unknown as CryptoService;

const svc = new PipelinesService(mockPrisma, mockCrypto);

const fakePipeline = {
  id: 'pipe-1', name: 'My Pipeline', repoUrl: 'https://github.com/user/repo.git',
  branch: 'main', githubTokenEnc: null, webhookSecret: 'secret123',
  workDir: '/opt/apps', buildCommands: ['npm run build'], deployCommands: ['pm2 reload app'],
  serverIds: ['srv-1'], enabled: true, createdAt: new Date(), updatedAt: new Date(),
};

beforeEach(() => jest.clearAllMocks());

describe('PipelinesService', () => {
  describe('create', () => {
    it('creates pipeline without githubToken when not provided', async () => {
      (mockPrisma.pipeline.create as jest.Mock).mockResolvedValue(fakePipeline);

      await svc.create({
        name: 'My Pipeline', repoUrl: 'https://github.com/user/repo.git',
        serverIds: ['srv-1'], buildCommands: [], deployCommands: [],
      } as any);

      const data = (mockPrisma.pipeline.create as jest.Mock).mock.calls[0][0].data;
      expect(data.githubTokenEnc).toBeNull();
      expect(mockCrypto.encrypt).not.toHaveBeenCalled();
    });

    it('encrypts githubToken when provided', async () => {
      (mockPrisma.pipeline.create as jest.Mock).mockResolvedValue(fakePipeline);

      await svc.create({
        name: 'P', repoUrl: 'https://github.com/u/r', serverIds: [],
        githubToken: 'ghp_mytoken', buildCommands: [], deployCommands: [],
      } as any);

      expect(mockCrypto.encrypt).toHaveBeenCalledWith('ghp_mytoken');
      const data = (mockPrisma.pipeline.create as jest.Mock).mock.calls[0][0].data;
      expect(data.githubTokenEnc).toBe('enc:ghp_mytoken');
    });

    it('defaults branch to main when not provided', async () => {
      (mockPrisma.pipeline.create as jest.Mock).mockResolvedValue(fakePipeline);

      await svc.create({ name: 'P', repoUrl: 'https://r', serverIds: [] } as any);

      const data = (mockPrisma.pipeline.create as jest.Mock).mock.calls[0][0].data;
      expect(data.branch).toBe('main');
    });

    it('defaults workDir to /opt/apps when not provided', async () => {
      (mockPrisma.pipeline.create as jest.Mock).mockResolvedValue(fakePipeline);

      await svc.create({ name: 'P', repoUrl: 'https://r', serverIds: [] } as any);

      const data = (mockPrisma.pipeline.create as jest.Mock).mock.calls[0][0].data;
      expect(data.workDir).toBe('/opt/apps');
    });

    it('defaults enabled to true when not provided', async () => {
      (mockPrisma.pipeline.create as jest.Mock).mockResolvedValue(fakePipeline);

      await svc.create({ name: 'P', repoUrl: 'https://r', serverIds: [] } as any);

      const data = (mockPrisma.pipeline.create as jest.Mock).mock.calls[0][0].data;
      expect(data.enabled).toBe(true);
    });

    it('generates a webhookSecret automatically', async () => {
      (mockPrisma.pipeline.create as jest.Mock).mockResolvedValue(fakePipeline);

      await svc.create({ name: 'P', repoUrl: 'https://r', serverIds: [] } as any);

      const data = (mockPrisma.pipeline.create as jest.Mock).mock.calls[0][0].data;
      expect(typeof data.webhookSecret).toBe('string');
      expect(data.webhookSecret).toHaveLength(16); // 8 bytes hex = 16 chars
    });
  });

  describe('findAll', () => {
    it('returns all pipelines ordered by createdAt desc', async () => {
      (mockPrisma.pipeline.findMany as jest.Mock).mockResolvedValue([fakePipeline]);

      const result = await svc.findAll();

      expect(result).toHaveLength(1);
      expect(mockPrisma.pipeline.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' } });
    });
  });

  describe('findOne', () => {
    it('returns pipeline when found', async () => {
      (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue(fakePipeline);

      await expect(svc.findOne('pipe-1')).resolves.toBe(fakePipeline);
    });

    it('throws NotFoundException when pipeline is missing', async () => {
      (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(svc.findOne('bad')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('updates pipeline without re-encrypting when githubToken not in payload', async () => {
      (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue(fakePipeline);
      (mockPrisma.pipeline.update as jest.Mock).mockResolvedValue(fakePipeline);

      await svc.update('pipe-1', { name: 'Renamed' } as any);

      expect(mockCrypto.encrypt).not.toHaveBeenCalled();
    });

    it('encrypts githubToken in update when provided', async () => {
      (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue(fakePipeline);
      (mockPrisma.pipeline.update as jest.Mock).mockResolvedValue(fakePipeline);

      await svc.update('pipe-1', { githubToken: 'new-token' } as any);

      expect(mockCrypto.encrypt).toHaveBeenCalledWith('new-token');
    });

    it('sets githubTokenEnc to null when githubToken is empty string', async () => {
      (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue(fakePipeline);
      (mockPrisma.pipeline.update as jest.Mock).mockResolvedValue(fakePipeline);

      await svc.update('pipe-1', { githubToken: '' } as any);

      const data = (mockPrisma.pipeline.update as jest.Mock).mock.calls[0][0].data;
      expect(data.githubTokenEnc).toBeNull();
      expect(data.githubToken).toBeUndefined();
    });

    it('throws NotFoundException for missing pipeline', async () => {
      (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(svc.update('bad', {} as any)).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes pipeline when found', async () => {
      (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue(fakePipeline);
      (mockPrisma.pipeline.delete as jest.Mock).mockResolvedValue(fakePipeline);

      const result = await svc.remove('pipe-1');

      expect(result).toBe(fakePipeline);
      expect(mockPrisma.pipeline.delete).toHaveBeenCalledWith({ where: { id: 'pipe-1' } });
    });

    it('throws NotFoundException when pipeline is missing', async () => {
      (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(svc.remove('bad')).rejects.toThrow(NotFoundException);
    });
  });

  describe('generateGithubConfig', () => {
    const fakeServerRecord = {
      id: 'srv-1', name: 'Prod Server', ip: '1.2.3.4',
      sshPort: 22, sshUser: 'root', sshAuthType: 'PASSWORD',
      sshAuthEnc: 'enc:mypassword',
    };

    it('throws NotFoundException when pipeline is missing', async () => {
      (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(svc.generateGithubConfig('bad')).rejects.toThrow(NotFoundException);
    });

    it('generates YAML with correct pipeline name', async () => {
      (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue(fakePipeline);
      (mockPrisma.server.findMany as jest.Mock).mockResolvedValue([fakeServerRecord]);

      const result = await svc.generateGithubConfig('pipe-1');

      expect(result.yaml).toContain('Deploy — My Pipeline');
    });

    it('includes SSH host, port, user secrets for single server', async () => {
      (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue(fakePipeline);
      (mockPrisma.server.findMany as jest.Mock).mockResolvedValue([fakeServerRecord]);

      const result = await svc.generateGithubConfig('pipe-1');

      const names = result.secrets.map((s) => s.name);
      expect(names).toContain('SSH_HOST');
      expect(names).toContain('SSH_PORT');
      expect(names).toContain('SSH_USER');
      expect(names).toContain('SSH_PASSWORD');
    });

    it('uses SSH_PASSWORD secret for PASSWORD auth type', async () => {
      (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue(fakePipeline);
      (mockPrisma.server.findMany as jest.Mock).mockResolvedValue([{ ...fakeServerRecord, sshAuthType: 'PASSWORD' }]);

      const result = await svc.generateGithubConfig('pipe-1');

      const secret = result.secrets.find((s) => s.name === 'SSH_PASSWORD');
      expect(secret).toBeDefined();
      expect(secret!.value).toBe('mypassword');
    });

    it('uses SSH_PRIVATE_KEY secret for KEY auth type', async () => {
      (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue(fakePipeline);
      (mockPrisma.server.findMany as jest.Mock).mockResolvedValue([{
        ...fakeServerRecord, sshAuthType: 'KEY', sshAuthEnc: 'enc:-----BEGIN RSA',
      }]);

      const result = await svc.generateGithubConfig('pipe-1');

      const secret = result.secrets.find((s) => s.name === 'SSH_PRIVATE_KEY');
      expect(secret).toBeDefined();
    });

    it('uses SERVER_N_ prefix for multiple servers', async () => {
      (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue({
        ...fakePipeline, serverIds: ['srv-1', 'srv-2'],
      });
      (mockPrisma.server.findMany as jest.Mock).mockResolvedValue([
        { ...fakeServerRecord, id: 'srv-1', name: 'Server 1' },
        { ...fakeServerRecord, id: 'srv-2', name: 'Server 2' },
      ]);

      const result = await svc.generateGithubConfig('pipe-1');

      const names = result.secrets.map((s) => s.name);
      expect(names).toContain('SERVER_1_SSH_HOST');
      expect(names).toContain('SERVER_2_SSH_HOST');
    });

    it('derives repo name from repoUrl', async () => {
      (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue(fakePipeline);
      (mockPrisma.server.findMany as jest.Mock).mockResolvedValue([fakeServerRecord]);

      const result = await svc.generateGithubConfig('pipe-1');

      expect(result.yaml).toContain('cd /opt/apps/repo');
    });

    it('includes build and deploy commands in YAML', async () => {
      (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue(fakePipeline);
      (mockPrisma.server.findMany as jest.Mock).mockResolvedValue([fakeServerRecord]);

      const result = await svc.generateGithubConfig('pipe-1');

      expect(result.yaml).toContain('npm run build');
      expect(result.yaml).toContain('pm2 reload app');
    });
  });
});
