import { spawnSync } from 'child_process';
import { ensureOriginNftables, preflightOriginHost, NFT_BOOTSTRAP_SCRIPT } from './cf-origin-dependencies';

const ref = `np_origin_${'a'.repeat(32)}`;
const ok = { code: 0, stdout: '/usr/sbin/nft', stderr: '' };
describe('guarded nftables dependency preparation', () => {
  it('has valid bash syntax and refuses upgrades, removals and global firewall activation', () => {
    const parsed = spawnSync('/bin/bash', ['-n'], { input: NFT_BOOTSTRAP_SCRIPT, encoding: 'utf8' });
    expect(parsed.status).toBe(0);
    expect(NFT_BOOTSTRAP_SCRIPT).toContain('0 upgraded, [1-9][0-9]* newly installed, 0 to remove');
    expect(NFT_BOOTSTRAP_SCRIPT).toContain('--no-remove');
    expect(NFT_BOOTSTRAP_SCRIPT).toContain('--no-upgrade');
    expect(NFT_BOOTSTRAP_SCRIPT).toContain('systemctl mask --runtime nftables.service');
    expect(NFT_BOOTSTRAP_SCRIPT).toContain('trap cleanup EXIT');
    expect(NFT_BOOTSTRAP_SCRIPT).toContain('cmp "$root/firewall-before.nft" "$root/firewall-after.nft"');
    expect(NFT_BOOTSTRAP_SCRIPT).not.toMatch(/flush ruleset|systemctl (?:enable|start|restart)|ufw |firewall-cmd/);
  });
  it('validates the required kernel syntax without installation on existing hosts', async () => {
    const ssh = { execCommand: jest.fn().mockResolvedValue(ok), dispose: jest.fn() };
    await ensureOriginNftables(ssh as any, 'pilot', 8443, ref);
    expect(ssh.execCommand).toHaveBeenCalledTimes(2);
    expect(ssh.execCommand.mock.calls[1][0]).toContain('nft -c -f -');
    expect(ssh.execCommand.mock.calls.map(x => x[0]).join('')).not.toContain('timeout 240 bash');
  });
  it('installs only when missing and then verifies actual kernel support', async () => {
    const ssh = { execCommand: jest.fn().mockResolvedValueOnce({ ...ok, code: 1 }).mockResolvedValue(ok), dispose: jest.fn() };
    await ensureOriginNftables(ssh as any, 'pilot', 8443, ref);
    expect(ssh.execCommand).toHaveBeenCalledTimes(3);
    expect(ssh.execCommand.mock.calls[1][0]).toContain('timeout 240 bash');
    expect(ssh.execCommand.mock.calls[2][0]).toContain('nft -c -f -');
  });
  it('does not reinstall or mutate a present but unusable nftables installation', async () => {
    const ssh = { execCommand: jest.fn().mockResolvedValueOnce(ok).mockResolvedValueOnce({ ...ok, code: 1 }), dispose: jest.fn() };
    await expect(ensureOriginNftables(ssh as any, 'pilot', 8443, ref)).rejects.toThrow('CAP_NET_ADMIN');
    expect(ssh.execCommand).toHaveBeenCalledTimes(2);
  });
  it('stops after an unsafe package plan or failed installation', async () => {
    const ssh = { execCommand: jest.fn().mockResolvedValue({ ...ok, code: 1 }), dispose: jest.fn() };
    await expect(ensureOriginNftables(ssh as any, 'pilot', 8443, ref)).rejects.toThrow('new-package-only');
    expect(ssh.execCommand).toHaveBeenCalledTimes(2);
  });
  it.each(['debian\n12\n6.1.0', 'ubuntu\n22.04\n5.15.0', 'ubuntu\n26.04\n7.0.0'])(
    'accepts a supported missing-package host without installing: %s', async platform => {
      const ssh = { execCommand: jest.fn().mockResolvedValueOnce({ ...ok, stdout: '0' })
        .mockResolvedValueOnce({ ...ok, code: 1 }).mockResolvedValueOnce({ ...ok, stdout: platform }), dispose: jest.fn() };
      await preflightOriginHost(ssh as any);
      expect(ssh.execCommand).toHaveBeenCalledTimes(3);
      expect(ssh.execCommand.mock.calls.map(x => x[0]).join('')).not.toContain('apt-get install');
    });
  it.each(['debian\n10\n4.19.0', 'ubuntu\n20.04\n5.4.0', 'alpine\n3.20\n6.1.0'])(
    'blocks unsupported bootstrap platforms before creating resources: %s', async platform => {
      const ssh = { execCommand: jest.fn().mockResolvedValueOnce({ ...ok, stdout: '0' })
        .mockResolvedValueOnce({ ...ok, code: 1 }).mockResolvedValueOnce({ ...ok, stdout: platform }), dispose: jest.fn() };
      await expect(preflightOriginHost(ssh as any)).rejects.toThrow('no resources created');
    });
});
