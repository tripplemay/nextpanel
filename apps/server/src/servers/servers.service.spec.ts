import { ServersService } from './servers.service';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { NotFoundException } from '@nestjs/common';

// Mock node-ssh before importing ServersService
const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockExecCommand = jest.fn().mockResolvedValue({ stdout: 'ok', stderr: '' });
const mockDispose = jest.fn();

jest.mock('node-ssh', () => ({
  NodeSSH: jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    execCommand: mockExecCommand,
    dispose: mockDispose,
  })),
}));

const mockPrisma = {
  server: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
} as unknown as PrismaService;

const mockCrypto = {
  encrypt: jest.fn((s: string) => `enc:${s}`),
  decrypt: jest.fn((s: string) => s.replace('enc:', '')),
} as unknown as CryptoService;

const svc = new ServersService(mockPrisma, mockCrypto);

const fakeServer = {
  id: 'srv-1', name: 'Test Server', ip: '1.2.3.4',
  sshPort: 22, sshUser: 'root', sshAuthType: 'PASSWORD',
  sshAuthEnc: 'enc:secret',
  status: 'ONLINE', tags: [], notes: null,
  createdAt: new Date(), updatedAt: new Date(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockConnect.mockResolvedValue(undefined);
  mockExecCommand.mockResolvedValue({ stdout: 'ok', stderr: '' });
});

describe('ServersService', () => {
  describe('create', () => {
    it('encrypts sshAuth and creates server', async () => {
      (mockPrisma.server.create as jest.Mock).mockResolvedValue(fakeServer);

      await svc.create({
        name: 'Test', ip: '1.2.3.4', sshAuth: 'mypassword',
        sshAuthType: 'PASSWORD' as any,
      } as any);

      expect(mockCrypto.encrypt).toHaveBeenCalledWith('mypassword');
      expect(mockPrisma.server.create).toHaveBeenCalled();
    });

    it('defaults sshPort to 22 when not provided', async () => {
      (mockPrisma.server.create as jest.Mock).mockResolvedValue(fakeServer);

      await svc.create({ name: 'T', ip: '1.2.3.4', sshAuth: 'pw', sshAuthType: 'PASSWORD' as any } as any);

      const data = (mockPrisma.server.create as jest.Mock).mock.calls[0][0].data;
      expect(data.sshPort).toBe(22);
    });

    it('defaults sshUser to root when not provided', async () => {
      (mockPrisma.server.create as jest.Mock).mockResolvedValue(fakeServer);

      await svc.create({ name: 'T', ip: '1.2.3.4', sshAuth: 'pw', sshAuthType: 'PASSWORD' as any } as any);

      const data = (mockPrisma.server.create as jest.Mock).mock.calls[0][0].data;
      expect(data.sshUser).toBe('root');
    });

    it('defaults tags to empty array when not provided', async () => {
      (mockPrisma.server.create as jest.Mock).mockResolvedValue(fakeServer);

      await svc.create({ name: 'T', ip: '1.2.3.4', sshAuth: 'pw', sshAuthType: 'PASSWORD' as any } as any);

      const data = (mockPrisma.server.create as jest.Mock).mock.calls[0][0].data;
      expect(data.tags).toEqual([]);
    });
  });

  describe('findAll', () => {
    it('returns all servers ordered by createdAt desc', async () => {
      (mockPrisma.server.findMany as jest.Mock).mockResolvedValue([fakeServer]);

      const result = await svc.findAll();

      expect(result).toHaveLength(1);
      const call = (mockPrisma.server.findMany as jest.Mock).mock.calls[0][0];
      expect(call.orderBy).toEqual({ createdAt: 'desc' });
    });
  });

  describe('findOne', () => {
    it('returns server when found', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServer);

      const result = await svc.findOne('srv-1');

      expect(result).toBe(fakeServer);
    });

    it('throws NotFoundException when server is missing', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(svc.findOne('bad')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('re-encrypts sshAuth when provided', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServer);
      (mockPrisma.server.update as jest.Mock).mockResolvedValue(fakeServer);

      await svc.update('srv-1', { sshAuth: 'newpassword' } as any);

      expect(mockCrypto.encrypt).toHaveBeenCalledWith('newpassword');
    });

    it('does not encrypt when sshAuth not in update payload', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServer);
      (mockPrisma.server.update as jest.Mock).mockResolvedValue(fakeServer);

      await svc.update('srv-1', { name: 'Renamed' } as any);

      expect(mockCrypto.encrypt).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for missing server', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(svc.update('bad', {} as any)).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes the server after verifying it exists', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServer);
      (mockPrisma.server.delete as jest.Mock).mockResolvedValue(fakeServer);

      await svc.remove('srv-1');

      expect(mockPrisma.server.delete).toHaveBeenCalledWith({ where: { id: 'srv-1' } });
    });

    it('throws NotFoundException when server is missing', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(svc.remove('bad')).rejects.toThrow(NotFoundException);
    });
  });

  describe('testSsh', () => {
    it('returns success=true when echo ok succeeds', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServer);

      const result = await svc.testSsh('srv-1');

      expect(result.success).toBe(true);
      expect(result.message).toBe('SSH connection successful');
    });

    it('connects with password when sshAuthType is PASSWORD', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue({
        ...fakeServer, sshAuthType: 'PASSWORD', sshAuthEnc: 'enc:mypassword',
      });

      await svc.testSsh('srv-1');

      expect(mockConnect).toHaveBeenCalledWith(
        expect.objectContaining({ password: 'mypassword' }),
      );
    });

    it('connects with privateKey when sshAuthType is KEY', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue({
        ...fakeServer, sshAuthType: 'KEY', sshAuthEnc: 'enc:-----BEGIN RSA',
      });

      await svc.testSsh('srv-1');

      expect(mockConnect).toHaveBeenCalledWith(
        expect.objectContaining({ privateKey: '-----BEGIN RSA' }),
      );
    });

    it('returns success=false when stdout is not "ok"', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServer);
      mockExecCommand.mockResolvedValue({ stdout: 'something else', stderr: '' });

      const result = await svc.testSsh('srv-1');

      expect(result.success).toBe(false);
    });

    it('returns success=false with error message on connection failure', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServer);
      mockConnect.mockRejectedValue(new Error('Connection refused'));

      const result = await svc.testSsh('srv-1');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Connection refused');
    });

    it('throws NotFoundException when server is missing', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(svc.testSsh('bad')).rejects.toThrow(NotFoundException);
    });

    it('handles non-Error thrown objects gracefully', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServer);
      mockConnect.mockRejectedValue('string error');

      const result = await svc.testSsh('srv-1');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Connection failed');
    });
  });
});
