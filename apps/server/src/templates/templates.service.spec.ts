import { TemplatesService } from './templates.service';
import { PrismaService } from '../prisma.service';
import { NotFoundException } from '@nestjs/common';

const mockPrisma = {
  template: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
} as unknown as PrismaService;

const svc = new TemplatesService(mockPrisma);

const fakeTemplate = {
  id: 'tpl-1',
  name: 'My Template',
  protocol: 'VMESS',
  implementation: 'XRAY',
  content: '{"port":{{port}}}',
  variables: ['port'],
  createdById: 'user-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => jest.clearAllMocks());

describe('TemplatesService', () => {
  describe('create', () => {
    it('calls prisma.template.create with correct data', async () => {
      (mockPrisma.template.create as jest.Mock).mockResolvedValue(fakeTemplate);
      const dto = { name: 'My Template', protocol: 'VMESS', content: '{}', variables: ['port'] } as any;
      await svc.create(dto, 'user-1');
      expect(mockPrisma.template.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ createdById: 'user-1' }) }),
      );
    });

    it('defaults variables to [] when not provided', async () => {
      (mockPrisma.template.create as jest.Mock).mockResolvedValue(fakeTemplate);
      const dto = { name: 'T', protocol: 'VLESS', content: '{}' } as any;
      await svc.create(dto, 'u');
      const data = (mockPrisma.template.create as jest.Mock).mock.calls[0][0].data;
      expect(data.variables).toEqual([]);
    });
  });

  describe('findOne', () => {
    it('returns the template when found', async () => {
      (mockPrisma.template.findUnique as jest.Mock).mockResolvedValue(fakeTemplate);
      const result = await svc.findOne('tpl-1');
      expect(result).toBe(fakeTemplate);
    });

    it('throws NotFoundException when template does not exist', async () => {
      (mockPrisma.template.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(svc.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('updates when template exists', async () => {
      (mockPrisma.template.findUnique as jest.Mock).mockResolvedValue(fakeTemplate);
      (mockPrisma.template.update as jest.Mock).mockResolvedValue({ ...fakeTemplate, name: 'New Name' });
      const result = await svc.update('tpl-1', { name: 'New Name' } as any);
      expect(result.name).toBe('New Name');
    });

    it('throws NotFoundException when updating non-existent template', async () => {
      (mockPrisma.template.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(svc.update('bad-id', { name: 'x' } as any)).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes and returns deleted template', async () => {
      (mockPrisma.template.findUnique as jest.Mock).mockResolvedValue(fakeTemplate);
      (mockPrisma.template.delete as jest.Mock).mockResolvedValue(fakeTemplate);
      const result = await svc.remove('tpl-1');
      expect(result).toBe(fakeTemplate);
      expect(mockPrisma.template.delete).toHaveBeenCalledWith({ where: { id: 'tpl-1' } });
    });

    it('throws NotFoundException when deleting non-existent template', async () => {
      (mockPrisma.template.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(svc.remove('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('render', () => {
    it('replaces {{variable}} placeholders with provided values', () => {
      expect(svc.render('port={{port}},uuid={{uuid}}', { port: '8080', uuid: 'abc' }))
        .toBe('port=8080,uuid=abc');
    });

    it('leaves unknown placeholders as empty string', () => {
      expect(svc.render('{{unknown}}', {})).toBe('');
    });

    it('handles template with no placeholders', () => {
      expect(svc.render('no placeholders here', { port: '80' })).toBe('no placeholders here');
    });

    it('handles empty string template', () => {
      expect(svc.render('', { port: '80' })).toBe('');
    });

    it('replaces multiple occurrences of same variable', () => {
      expect(svc.render('{{port}}:{{port}}', { port: '9000' })).toBe('9000:9000');
    });
  });
});
