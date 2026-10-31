import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, copyFileSync, chmodSync, mkdtempSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

// Official XTLS/Xray-core v26.2.6 release asset digest, reviewed at packaging time.
const expected = '29ce535b56e207a406ffa1c2d4842dcc410be003eff8ec508bb732abc9f8e385';
const [archive, destination] = process.argv.slice(2);
if (!archive || !destination) throw new Error('Usage: node package-scf.mjs Xray-linux-64.zip OUTPUT.zip');
const sha = data => createHash('sha256').update(data).digest('hex');
if (sha(readFileSync(archive)) !== expected) throw new Error('XRAY_ARCHIVE_CHECKSUM_MISMATCH');
const output = resolve(destination);
if (existsSync(output)) throw new Error('Refusing to overwrite an existing release package');
mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
const temp = mkdtempSync(join(tmpdir(), 'np-scf-package-'));
try {
  const binary = execFileSync('unzip', ['-p', resolve(archive), 'xray'], { maxBuffer: 100 * 1024 * 1024 });
  if (binary.subarray(0, 4).toString('hex') !== '7f454c46' || binary[18] !== 62 || binary[19] !== 0) throw new Error('Expected Linux amd64 ELF');
  writeFileSync(join(temp, 'xray'), binary, { mode: 0o755 });
  for (const name of ['server.mjs', 'scf_bootstrap']) copyFileSync(join(import.meta.dirname, name), join(temp, name));
  chmodSync(join(temp, 'scf_bootstrap'), 0o755);
  execFileSync('zip', ['-q', output, 'server.mjs', 'scf_bootstrap', 'xray'], { cwd: temp });
  chmodSync(output, 0o600);
  const manifest = { xrayVersion: '26.2.6', xrayArchiveSha256: expected,
    files: Object.fromEntries(['server.mjs', 'scf_bootstrap', 'xray'].map(name => [name, sha(readFileSync(join(temp, name)))])),
    zipSha256: sha(readFileSync(output)), zipBytes: readFileSync(output).length };
  writeFileSync(output + '.manifest.json', JSON.stringify(manifest, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(manifest));
} finally { rmSync(temp, { recursive: true, force: true }); }
