import { CertService } from './cert.service';

// ── Mock child_process.execFile ───────────────────────────────────────────────
const mockExecFile = jest.fn();
jest.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

// ── Mock NodeSSH ───────────────────────────────────────────────────────────────
const mockSshExecCommand = jest.fn().mockResolvedValue({ stdout: '', stderr: '', code: 0 });
const mockPutFile = jest.fn().mockResolvedValue(undefined);
const mockSsh = {
  execCommand: mockSshExecCommand,
  putFile: mockPutFile,
} as any;

const svc = new CertService();

beforeEach(() => {
  jest.clearAllMocks();
  mockSshExecCommand.mockResolvedValue({ stdout: '', stderr: '', code: 0 });
  mockPutFile.mockResolvedValue(undefined);
});

describe('CertService', () => {
  describe('getCertPaths', () => {
    it('returns paths with wildcard domain directory', () => {
      const { certPath, keyPath } = svc.getCertPaths('example.com');
      expect(certPath).toContain('*.example.com_ecc');
      expect(certPath).toContain('fullchain.cer');
      expect(keyPath).toContain('*.example.com_ecc');
      expect(keyPath).toContain('*.example.com.key');
    });

    it('certPath and keyPath are under acme home directory', () => {
      const { certPath, keyPath } = svc.getCertPaths('test.com');
      expect(certPath).toContain('.acme.sh');
      expect(keyPath).toContain('.acme.sh');
    });
  });

  describe('isCertValid', () => {
    it('returns true when openssl exits with code 0 (cert valid)', async () => {
      mockExecFile.mockImplementationOnce((_bin: string, _args: string[], cb: Function) => {
        cb(null); // no error = cert valid
      });

      const result = await svc.isCertValid('/path/to/cert.crt');
      expect(result).toBe(true);
    });

    it('returns false when openssl exits with non-zero code (cert expired/missing)', async () => {
      mockExecFile.mockImplementationOnce((_bin: string, _args: string[], cb: Function) => {
        cb(new Error('cert expired')); // error = cert invalid
      });

      const result = await svc.isCertValid('/path/to/cert.crt');
      expect(result).toBe(false);
    });

    it('calls openssl with correct arguments', async () => {
      mockExecFile.mockImplementationOnce((_bin: string, _args: string[], cb: Function) => {
        cb(null);
      });

      await svc.isCertValid('/etc/certs/my.crt');

      expect(mockExecFile).toHaveBeenCalledWith(
        'openssl',
        ['x509', '-checkend', '2592000', '-noout', '-in', '/etc/certs/my.crt'],
        expect.any(Function),
      );
    });
  });

  describe('pushCertToNode', () => {
    it('validates, backs up, and atomically activates a changed certificate pair', async () => {
      mockSshExecCommand.mockImplementation(async (command: string) => {
        if (command.startsWith("test -f '/etc/nextpanel/certs/node-123.crt' &&")) {
          return { stdout: '', stderr: '', code: 1 };
        }
        if (command === "test -f '/etc/nextpanel/certs/node-123.crt'" ||
            command === "test -f '/etc/nextpanel/certs/node-123.key'") {
          return { stdout: '', stderr: '', code: 1 };
        }
        return { stdout: '', stderr: '', code: 0 };
      });
      const logs: string[] = [];
      const update = await svc.pushCertToNode(
        mockSsh,
        'node-123',
        'example.com',
        (l) => logs.push(l),
      );
      expect(update.changed).toBe(true);

      expect(mockSshExecCommand).toHaveBeenCalledWith(
        "mkdir -p -- '/etc/nextpanel/certs' && chmod 0755 '/etc/nextpanel/certs'",
      );
      expect(mockPutFile).toHaveBeenCalledTimes(2);
      const [certSrc, certDst] = mockPutFile.mock.calls[0];
      const [keySrc, keyDst] = mockPutFile.mock.calls[1];
      expect(certDst).toMatch(/^\/etc\/nextpanel\/certs\/node-123\.crt\.next-/);
      expect(keyDst).toMatch(/^\/etc\/nextpanel\/certs\/node-123\.key\.next-/);
      expect(certSrc).toContain('fullchain.cer');
      expect(keySrc).toContain('*.example.com.key');
      expect(mockPutFile).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        expect.stringMatching(/^\/etc\/nextpanel\/certs\/node-123\.crt\.next-/),
        null,
        { mode: 0o644 },
      );
      expect(mockPutFile).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        expect.stringMatching(/^\/etc\/nextpanel\/certs\/node-123\.key\.next-/),
        null,
        { mode: 0o600 },
      );
      const commands = mockSshExecCommand.mock.calls.map((call) => call[0] as string);
      expect(commands.some((command) =>
        command.includes('openssl x509 -noout') && command.includes(String(certDst)),
      )).toBe(true);
      expect(commands.some((command) =>
        command.startsWith('failed=0;') && command.includes('mv -f --') &&
        command.includes("chmod 0600 '/etc/nextpanel/certs/node-123.key'"),
      )).toBe(true);
      expect(commands.some((command) =>
        command.includes("openssl x509 -noout -in '/etc/nextpanel/certs/node-123.crt'"),
      )).toBe(true);
      expect(logs.some((line) => line.includes('retaining rollback pair'))).toBe(true);
      await update.commit();
      expect(logs.some((line) => line.includes('deployed to'))).toBe(true);
    });

    it('returns unchanged without replacing the installed files', async () => {
      const logs: string[] = [];

      const update = await svc.pushCertToNode(
        mockSsh,
        'node-123',
        'example.com',
        (line) => logs.push(line),
      );
      expect(update.changed).toBe(false);

      const commands = mockSshExecCommand.mock.calls.map((call) => call[0] as string);
      expect(commands.some((command) => command.includes('mv -f --'))).toBe(false);
      expect(logs.some((line) => line.includes('already current'))).toBe(true);
    });

    it('keeps the previous pair until the caller commits and can roll it back', async () => {
      mockSshExecCommand.mockImplementation(async (command: string) => {
        if (command.startsWith("test -f '/etc/nextpanel/certs/node-123.crt' &&")) {
          return { stdout: '', stderr: '', code: 1 };
        }
        return { stdout: '', stderr: '', code: 0 };
      });

      const update = await svc.pushCertToNode(
        mockSsh,
        'node-123',
        'example.com',
        jest.fn(),
      );
      expect(update.changed).toBe(true);
      const commandsBeforeRollback = mockSshExecCommand.mock.calls.map(
        (call) => String(call[0]),
      );
      expect(commandsBeforeRollback.some(
        (command) => command.startsWith('rm -f --') && command.includes('.rollback-'),
      )).toBe(false);

      await expect(update.rollback()).resolves.toBe(true);
      expect(mockSshExecCommand.mock.calls.some(
        (call) => String(call[0]).startsWith('failed=0;') &&
          String(call[0]).includes('cp -p --') && String(call[0]).includes('.rollback-'),
      )).toBe(true);
    });

    it('rejects an invalid uploaded certificate pair before replacing active files', async () => {
      mockSshExecCommand.mockImplementation(async (command: string) => {
        if (command.includes('openssl x509 -noout')) {
          return { stdout: '', stderr: 'key mismatch', code: 1 };
        }
        return { stdout: '', stderr: '', code: 0 };
      });

      await expect(
        svc.pushCertToNode(mockSsh, 'node-123', 'example.com', jest.fn()),
      ).rejects.toThrow('do not form a valid pair');

      expect(mockSshExecCommand.mock.calls.some(
        (call) => String(call[0]).includes('mv -f --'),
      )).toBe(false);
    });

    it('restores the previous pair when atomic activation fails', async () => {
      const logs: string[] = [];
      mockSshExecCommand.mockImplementation(async (command: string) => {
        if (command.startsWith("test -f '/etc/nextpanel/certs/node-123.crt' &&")) {
          return { stdout: '', stderr: '', code: 1 };
        }
        if (command.startsWith('failed=0;') && command.includes('mv -f --')) {
          return { stdout: '', stderr: 'permission denied', code: 1 };
        }
        return { stdout: '', stderr: '', code: 0 };
      });

      await expect(
        svc.pushCertToNode(mockSsh, 'node-123', 'example.com', (line) => logs.push(line)),
      ).rejects.toThrow('Failed to atomically activate');

      const commands = mockSshExecCommand.mock.calls.map((call) => call[0] as string);
      const restore = commands.find((command) =>
        command.startsWith('failed=0;') && command.includes('cp -p --') &&
        command.includes('.rollback-'),
      );
      expect(restore).toContain("'/etc/nextpanel/certs/node-123.crt'");
      expect(restore).toContain("'/etc/nextpanel/certs/node-123.key'");
      expect(logs.join('\n')).toContain('Previous TLS certificate restored');
    });

    it('retains exact backup paths when activation and rollback both fail', async () => {
      const logs: string[] = [];
      mockSshExecCommand.mockImplementation(async (command: string) => {
        if (command.startsWith("test -f '/etc/nextpanel/certs/node-123.crt' &&")) {
          return { stdout: '', stderr: '', code: 1 };
        }
        if (command.startsWith('failed=0;')) {
          return { stdout: '', stderr: 'disk failure', code: 1 };
        }
        return { stdout: '', stderr: '', code: 0 };
      });

      await expect(
        svc.pushCertToNode(mockSsh, 'node-123', 'example.com', (line) => logs.push(line)),
      ).rejects.toThrow('Failed to atomically activate');

      expect(logs.join('\n')).toMatch(
        /backups retained at \/etc\/nextpanel\/certs\/node-123\.crt\.rollback-[\w-]+ and \/etc\/nextpanel\/certs\/node-123\.key\.rollback-[\w-]+/,
      );
    });
  });

  describe('ensureWildcardCert', () => {
    it('returns cert paths without reissuing when cert is already valid', async () => {
      // acme.sh binary exists
      mockExecFile.mockImplementationOnce((_bin: string, _args: string[], cb: Function) => {
        cb(null); // test -x acme.sh → installed
      });
      // openssl checkend → cert valid
      mockExecFile.mockImplementationOnce((_bin: string, _args: string[], cb: Function) => {
        cb(null); // cert valid
      });

      const logs: string[] = [];
      const result = await svc.ensureWildcardCert('cf-token', 'example.com', (l) => logs.push(l));

      expect(result.certPath).toContain('fullchain.cer');
      expect(result.keyPath).toContain('.key');
      expect(logs.some((l) => l.includes('is valid'))).toBe(true);
    });

    it('issues a new cert when cert is missing/expired', async () => {
      // acme.sh binary exists
      mockExecFile.mockImplementationOnce((_bin: string, _args: string[], cb: Function) => {
        cb(null); // test -x acme.sh → installed
      });
      // openssl checkend → cert invalid
      mockExecFile.mockImplementationOnce((_bin: string, _args: string[], cb: Function) => {
        cb(new Error('cert invalid'));
      });
      // acme.sh --issue → success
      mockExecFile.mockImplementationOnce(
        (_bin: string, _args: string[], _opts: object, cb: Function) => {
          cb(null, '', '');
        },
      );

      const logs: string[] = [];
      const result = await svc.ensureWildcardCert('cf-token', 'example.com', (l) => logs.push(l));

      expect(result.certPath).toContain('fullchain.cer');
      expect(logs.some((l) => l.includes('Issuing wildcard cert'))).toBe(true);
      expect(logs.some((l) => l.includes('issued'))).toBe(true);
    });

    it('installs acme.sh when binary is not present', async () => {
      // test -x acme.sh → not installed
      mockExecFile.mockImplementationOnce((_bin: string, _args: string[], cb: Function) => {
        cb(new Error('not found'));
      });
      // sh -c 'curl ... | sh' → install succeeds
      mockExecFile.mockImplementationOnce(
        (_bin: string, _args: string[], cb: Function) => {
          cb(null, 'install output', '');
        },
      );
      // test -x acme.sh → now installed
      mockExecFile.mockImplementationOnce((_bin: string, _args: string[], cb: Function) => {
        cb(null);
      });
      // openssl checkend → cert valid
      mockExecFile.mockImplementationOnce((_bin: string, _args: string[], cb: Function) => {
        cb(null);
      });

      const logs: string[] = [];
      await svc.ensureWildcardCert('cf-token', 'example.com', (l) => logs.push(l));

      expect(logs.some((l) => l.includes('acme.sh not found') || l.includes('install output'))).toBe(true);
    });

    it('throws when acme.sh install fails', async () => {
      // test -x acme.sh → not installed
      mockExecFile.mockImplementationOnce((_bin: string, _args: string[], cb: Function) => {
        cb(new Error('not found'));
      });
      // sh -c 'curl ... | sh' → install script fails
      mockExecFile.mockImplementationOnce(
        (_bin: string, _args: string[], cb: Function) => {
          cb(new Error('curl failed'), '', '');
        },
      );

      await expect(
        svc.ensureWildcardCert('cf-token', 'example.com', () => {}),
      ).rejects.toThrow('acme.sh install failed');
    });

    it('throws when acme.sh install exits 0 but binary not found', async () => {
      // test -x acme.sh → not installed
      mockExecFile.mockImplementationOnce((_bin: string, _args: string[], cb: Function) => {
        cb(new Error('not found'));
      });
      // sh -c install → exits 0 (no error)
      mockExecFile.mockImplementationOnce(
        (_bin: string, _args: string[], cb: Function) => {
          cb(null, '', '');
        },
      );
      // test -x acme.sh → still not found
      mockExecFile.mockImplementationOnce((_bin: string, _args: string[], cb: Function) => {
        cb(new Error('still not found'));
      });

      await expect(
        svc.ensureWildcardCert('cf-token', 'example.com', () => {}),
      ).rejects.toThrow('binary not found at');
    });

    it('throws when acme.sh --issue fails with non-2 exit code', async () => {
      // test -x acme.sh → installed
      mockExecFile.mockImplementationOnce((_bin: string, _args: string[], cb: Function) => {
        cb(null);
      });
      // openssl → cert invalid
      mockExecFile.mockImplementationOnce((_bin: string, _args: string[], cb: Function) => {
        cb(new Error('expired'));
      });
      // acme.sh --issue → fails with code 1
      const err = Object.assign(new Error('acme failed'), { code: 1 });
      mockExecFile.mockImplementationOnce(
        (_bin: string, _args: string[], _opts: object, cb: Function) => {
          cb(err, '', 'acme error output');
        },
      );

      await expect(
        svc.ensureWildcardCert('cf-token', 'example.com', () => {}),
      ).rejects.toThrow('acme.sh failed');
    });

    it('treats acme.sh exit code 2 as success (cert already valid)', async () => {
      // test -x acme.sh → installed
      mockExecFile.mockImplementationOnce((_bin: string, _args: string[], cb: Function) => {
        cb(null);
      });
      // openssl → cert invalid (to trigger issue)
      mockExecFile.mockImplementationOnce((_bin: string, _args: string[], cb: Function) => {
        cb(new Error('expired'));
      });
      // acme.sh --issue → exit code 2 (skip/already valid, treated as success)
      const err = Object.assign(new Error('already valid'), { code: 2 });
      mockExecFile.mockImplementationOnce(
        (_bin: string, _args: string[], _opts: object, cb: Function) => {
          cb(err, 'output', '');
        },
      );

      const logs: string[] = [];
      const result = await svc.ensureWildcardCert('cf-token', 'example.com', (l) => logs.push(l));

      // Should not throw — exit code 2 is treated as success
      expect(result.certPath).toContain('fullchain.cer');
    });
  });

  describe('renewWildcardCert', () => {
    it('returns false without renewing when cert is still valid', async () => {
      // openssl → cert valid
      mockExecFile.mockImplementationOnce((_bin: string, _args: string[], cb: Function) => {
        cb(null);
      });

      const logs: string[] = [];
      const renewed = await svc.renewWildcardCert('cf-token', 'example.com', (l) => logs.push(l));

      expect(renewed).toBe(false);
      expect(logs.some((l) => l.includes('still valid'))).toBe(true);
    });

    it('returns true and renews when cert is expired', async () => {
      // openssl → cert expired
      mockExecFile.mockImplementationOnce((_bin: string, _args: string[], cb: Function) => {
        cb(new Error('expired'));
      });
      // acme.sh --renew → success
      mockExecFile.mockImplementationOnce(
        (_bin: string, _args: string[], _opts: object, cb: Function) => {
          cb(null, '', '');
        },
      );

      const logs: string[] = [];
      const renewed = await svc.renewWildcardCert('cf-token', 'example.com', (l) => logs.push(l));

      expect(renewed).toBe(true);
      expect(logs.some((l) => l.includes('Renewing'))).toBe(true);
      expect(logs.some((l) => l.includes('renewed'))).toBe(true);
    });
  });
});
