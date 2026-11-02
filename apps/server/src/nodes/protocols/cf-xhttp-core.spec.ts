import { ensureCfXhttpCore, ensureRealityCore, CF_XHTTP_CORE_BIN, REALITY_CORE_BIN, usageXrayBinary } from './cf-xhttp-core';

const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
const missing = { code: 127, stdout: '', stderr: '' };

describe('isolated reviewed Xray core', () => {
  it('reuses a reviewed shared core without writes', async () => {
    const ssh = { execCommand: jest.fn().mockResolvedValue(ok('Xray 26.10.31 (Xray)')), dispose: jest.fn() };
    expect(await ensureCfXhttpCore(ssh as any)).toBe('/usr/local/bin/xray');
    expect(ssh.execCommand).toHaveBeenCalledTimes(1);
  });
  it.each(['26.3.27', '25.3.6', 'missing'])('uses an already prepared isolated core with shared=%s', async version => {
    const ssh = { execCommand: jest.fn().mockResolvedValueOnce(ok(`Xray ${version}`)).mockResolvedValueOnce(ok('Xray 26.10.31')), dispose: jest.fn() };
    expect(await ensureCfXhttpCore(ssh as any)).toBe(CF_XHTTP_CORE_BIN);
    expect(ssh.execCommand).toHaveBeenCalledTimes(2);
  });
  it.each(['x86_64', 'aarch64'])('installs a checksum-pinned isolated core on %s without touching shared paths', async arch => {
    const ssh = { execCommand: jest.fn().mockResolvedValueOnce(ok('Xray 26.3.27')).mockResolvedValueOnce(missing)
      .mockResolvedValueOnce(ok(arch)).mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok('Xray 26.10.31')), dispose: jest.fn() };
    expect(await ensureCfXhttpCore(ssh as any)).toBe(CF_XHTTP_CORE_BIN);
    const install = ssh.execCommand.mock.calls[3][0];
    expect(install).toContain('/releases/download/v26.10.31/');
    expect(install).toContain('sha256sum -c -');
    expect(install).toContain('test ! -e');
    expect(install).not.toMatch(/latest|\/usr\/local\/bin\/xray|systemctl|apt-get/);
  });
  it('never proceeds after an archive or installation failure', async () => {
    const ssh = { execCommand: jest.fn().mockResolvedValueOnce(missing).mockResolvedValueOnce(missing)
      .mockResolvedValueOnce(ok('x86_64')).mockResolvedValueOnce({ ...missing, code: 1 }), dispose: jest.fn() };
    await expect(ensureCfXhttpCore(ssh as any)).rejects.toThrow('preparation failed');
    expect(ssh.execCommand).toHaveBeenCalledTimes(4);
  });
  it.each(['armv7l', 's390x', ''])('rejects unsupported architecture %s before downloading', async arch => {
    const ssh = { execCommand: jest.fn().mockResolvedValueOnce(missing).mockResolvedValueOnce(missing).mockResolvedValueOnce(ok(arch)), dispose: jest.fn() };
    await expect(ensureCfXhttpCore(ssh as any)).rejects.toThrow('shared core unchanged');
    expect(ssh.execCommand).toHaveBeenCalledTimes(3);
  });
  it.each(['26.2.6', '26.3.27'])('keeps a compatible REALITY shared core: %s', async version => {
    const ssh = { execCommand: jest.fn().mockResolvedValue(ok(`Xray ${version}`)), dispose: jest.fn() };
    const dependencies = jest.fn();
    expect(await ensureRealityCore(ssh as any, undefined, dependencies)).toBe('/usr/local/bin/xray');
    expect(dependencies).not.toHaveBeenCalled();
    expect(ssh.execCommand).toHaveBeenCalledTimes(1);
  });
  it('isolates REALITY from a newer incompatible shared core without downgrading it', async () => {
    const ssh = { execCommand: jest.fn().mockResolvedValueOnce(ok('Xray 26.10.31')).mockResolvedValueOnce(missing)
      .mockResolvedValueOnce(ok('x86_64')).mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok('Xray 26.3.27')), dispose: jest.fn() };
    const dependencies = jest.fn(async () => { expect(ssh.execCommand).toHaveBeenCalledTimes(3); });
    expect(await ensureRealityCore(ssh as any, undefined, dependencies)).toBe(REALITY_CORE_BIN);
    expect(dependencies).toHaveBeenCalledTimes(1);
    expect(ssh.execCommand.mock.calls[3][0]).toContain('/releases/download/v26.3.27/');
    expect(ssh.execCommand.mock.calls[3][0]).not.toContain('/usr/local/bin/xray');
  });
  it('stops before downloading REALITY if dependency provisioning fails', async () => {
    const ssh = { execCommand: jest.fn().mockResolvedValueOnce(missing).mockResolvedValueOnce(missing)
      .mockResolvedValueOnce(ok('x86_64')), dispose: jest.fn() };
    await expect(ensureRealityCore(ssh as any, undefined, async () => { throw Error('unzip unavailable'); })).rejects.toThrow('unzip unavailable');
    expect(ssh.execCommand).toHaveBeenCalledTimes(3);
  });
  it.each(['/usr/local/bin/xray', CF_XHTTP_CORE_BIN, REALITY_CORE_BIN, '/usr/local/lib/nextpanel/xray-26.2.6/xray'])('uses the deployed core for usage synchronization: %s', path => {
    expect(usageXrayBinary(`{ path=${path} ; argv[]=${path} run -config /etc/nextpanel/nodes/n.json ; }`)).toBe(path);
  });
  it.each(['', '{ path=/tmp/xray ; }', '{ path=/usr/local/lib/nextpanel/xray-26.3.28/xray ; }', '{ path=/bin/sh ; argv[]=/usr/local/bin/xray ; }'])('rejects unexpected usage entrypoint %s', entry => {
    expect(() => usageXrayBinary(entry)).toThrow('UNEXPECTED_CORE_PATH');
  });
});
