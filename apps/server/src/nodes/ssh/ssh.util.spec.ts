import { connectSsh, uploadText, binaryExists, whichBinary, detectPackageManager } from './ssh.util';
import { NodeSSH } from 'node-ssh';

jest.mock('node-ssh');

const MockNodeSSH = NodeSSH as jest.MockedClass<typeof NodeSSH>;

function makeMockSsh(overrides: Partial<InstanceType<typeof NodeSSH>> = {}) {
  const instance = new MockNodeSSH() as jest.Mocked<InstanceType<typeof NodeSSH>>;
  instance.connect = jest.fn().mockResolvedValue(instance);
  instance.execCommand = jest.fn().mockResolvedValue({ stdout: '', stderr: '', code: 0 });
  instance.dispose = jest.fn();
  Object.assign(instance, overrides);
  return instance;
}

// ── connectSsh ────────────────────────────────────────────────────────────────

describe('connectSsh', () => {
  beforeEach(() => {
    MockNodeSSH.mockClear();
  });

  it('connects with password auth', async () => {
    const mockInst = makeMockSsh();
    MockNodeSSH.mockImplementation(() => mockInst);

    await connectSsh({
      host: '1.2.3.4', port: 22, username: 'root',
      authType: 'PASSWORD', auth: 'mypassword',
    });

    expect(mockInst.connect).toHaveBeenCalledWith(
      expect.objectContaining({ password: 'mypassword' }),
    );
    expect(mockInst.connect).toHaveBeenCalledWith(
      expect.not.objectContaining({ privateKey: expect.anything() }),
    );
  });

  it('connects with key auth', async () => {
    const mockInst = makeMockSsh();
    MockNodeSSH.mockImplementation(() => mockInst);

    await connectSsh({
      host: '1.2.3.4', port: 22, username: 'root',
      authType: 'KEY', auth: '-----BEGIN RSA...',
    });

    expect(mockInst.connect).toHaveBeenCalledWith(
      expect.objectContaining({ privateKey: '-----BEGIN RSA...' }),
    );
  });

  it('uses default readyTimeout of 10000 when not specified', async () => {
    const mockInst = makeMockSsh();
    MockNodeSSH.mockImplementation(() => mockInst);

    await connectSsh({ host: 'h', port: 22, username: 'u', authType: 'PASSWORD', auth: 'p' });

    expect(mockInst.connect).toHaveBeenCalledWith(
      expect.objectContaining({ readyTimeout: 10000 }),
    );
  });

  it('uses custom readyTimeout when provided', async () => {
    const mockInst = makeMockSsh();
    MockNodeSSH.mockImplementation(() => mockInst);

    await connectSsh({ host: 'h', port: 22, username: 'u', authType: 'PASSWORD', auth: 'p', readyTimeout: 5000 });

    expect(mockInst.connect).toHaveBeenCalledWith(
      expect.objectContaining({ readyTimeout: 5000 }),
    );
  });

  it('propagates connection errors', async () => {
    const mockInst = makeMockSsh();
    mockInst.connect = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    MockNodeSSH.mockImplementation(() => mockInst);

    await expect(
      connectSsh({ host: 'h', port: 22, username: 'u', authType: 'PASSWORD', auth: 'p' }),
    ).rejects.toThrow('ECONNREFUSED');
  });
});

// ── uploadText ────────────────────────────────────────────────────────────────

describe('uploadText', () => {
  it('creates parent directory then writes base64-decoded content', async () => {
    const ssh = makeMockSsh();
    await uploadText(ssh, 'hello world', '/etc/myapp/config.json');

    const calls = (ssh.execCommand as jest.Mock).mock.calls as [string][];
    const mkdirCall = calls.find(([cmd]) => cmd.startsWith('mkdir'));
    const writeCall = calls.find(([cmd]) => cmd.includes('base64 -d'));

    expect(mkdirCall).toBeDefined();
    expect(mkdirCall![0]).toContain('/etc/myapp');
    expect(writeCall).toBeDefined();
    expect(writeCall![0]).toContain('> /etc/myapp/config.json');

    // Verify the base64 payload decodes back to original content
    const match = writeCall![0].match(/echo (.+) \| base64/);
    expect(match).not.toBeNull();
    expect(Buffer.from(match![1], 'base64').toString()).toBe('hello world');
  });
});

// ── binaryExists ──────────────────────────────────────────────────────────────

describe('binaryExists', () => {
  it('returns true when test -x exits 0', async () => {
    const ssh = makeMockSsh();
    (ssh.execCommand as jest.Mock).mockResolvedValue({ code: 0, stdout: '', stderr: '' });
    await expect(binaryExists(ssh, '/usr/bin/xray')).resolves.toBe(true);
  });

  it('returns false when test -x exits non-zero', async () => {
    const ssh = makeMockSsh();
    (ssh.execCommand as jest.Mock).mockResolvedValue({ code: 1, stdout: '', stderr: '' });
    await expect(binaryExists(ssh, '/usr/bin/xray')).resolves.toBe(false);
  });
});

// ── whichBinary ───────────────────────────────────────────────────────────────

describe('whichBinary', () => {
  it('returns the resolved path when which succeeds', async () => {
    const ssh = makeMockSsh();
    (ssh.execCommand as jest.Mock).mockResolvedValue({ code: 0, stdout: '/usr/bin/ss-server\n', stderr: '' });
    await expect(whichBinary(ssh, 'ss-server')).resolves.toBe('/usr/bin/ss-server');
  });

  it('returns null when which exits non-zero', async () => {
    const ssh = makeMockSsh();
    (ssh.execCommand as jest.Mock).mockResolvedValue({ code: 1, stdout: '', stderr: '' });
    await expect(whichBinary(ssh, 'missing')).resolves.toBeNull();
  });

  it('returns null when stdout is empty even on exit 0', async () => {
    const ssh = makeMockSsh();
    (ssh.execCommand as jest.Mock).mockResolvedValue({ code: 0, stdout: '   ', stderr: '' });
    await expect(whichBinary(ssh, 'empty')).resolves.toBeNull();
  });
});

// ── detectPackageManager ──────────────────────────────────────────────────────

describe('detectPackageManager', () => {
  it('returns apt when apt-get is available', async () => {
    const ssh = makeMockSsh();
    (ssh.execCommand as jest.Mock)
      .mockResolvedValueOnce({ code: 0 })   // apt-get
      .mockResolvedValueOnce({ code: 1 })   // dnf
      .mockResolvedValueOnce({ code: 1 });  // yum
    await expect(detectPackageManager(ssh)).resolves.toBe('apt');
  });

  it('returns dnf when dnf is available but not apt', async () => {
    const ssh = makeMockSsh();
    (ssh.execCommand as jest.Mock)
      .mockResolvedValueOnce({ code: 1 })   // apt-get
      .mockResolvedValueOnce({ code: 0 })   // dnf
      .mockResolvedValueOnce({ code: 1 });  // yum
    await expect(detectPackageManager(ssh)).resolves.toBe('dnf');
  });

  it('returns yum when yum is available but not apt/dnf', async () => {
    const ssh = makeMockSsh();
    (ssh.execCommand as jest.Mock)
      .mockResolvedValueOnce({ code: 1 })   // apt-get
      .mockResolvedValueOnce({ code: 1 })   // dnf
      .mockResolvedValueOnce({ code: 0 });  // yum
    await expect(detectPackageManager(ssh)).resolves.toBe('yum');
  });

  it('returns null when no package manager is found', async () => {
    const ssh = makeMockSsh();
    (ssh.execCommand as jest.Mock).mockResolvedValue({ code: 1 });
    await expect(detectPackageManager(ssh)).resolves.toBeNull();
  });
});
