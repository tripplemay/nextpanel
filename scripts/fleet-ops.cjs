// Run on the panel host: node --env-file=.env /path/fleet-ops.cjs MODE ARTIFACT_DIR [SERVER_ID]
// Credentials stay in memory; restricted artifacts contain subscription bearer URLs.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createRequire } = require('node:module');
const req = createRequire(path.join(process.cwd(), 'package.json'));
const { PrismaClient } = req('@prisma/client');
const { NodeSSH } = req('node-ssh');
const prisma = new PrismaClient();
const [mode, root, serverId] = process.argv.slice(2);
if (!root || !path.isAbsolute(root)) throw new Error('Absolute artifact directory required');
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const save = (name, data) => fs.writeFileSync(path.join(root, name), JSON.stringify(data, null, 2), { mode: 0o600 });
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const q = s => "'" + String(s).replaceAll("'", "'\"'\"'") + "'";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function decrypt(value) {
  const b = Buffer.from(value, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(process.env.ENCRYPTION_KEY, 'hex'), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return d.update(b.subarray(28), undefined, 'utf8') + d.final('utf8');
}
async function exec(ssh, command) {
  const result = await ssh.execCommand(command, { execOptions: { timeout: 30000 } });
  if (result.code !== 0) throw new Error(`Remote exit ${result.code}: ${result.stderr.slice(0, 500)}`);
  return result.stdout;
}
async function connect(server, expected) {
  if (server.id === process.env.LOCAL_SERVER_ID) {
    if (!Object.values(os.networkInterfaces()).flat().some(item => item?.address === server.ip)) throw new Error('Local server IP mismatch');
    const fingerprint = `local:${server.id}`;
    if (expected && expected !== fingerprint) throw new Error('Local baseline mismatch');
    return { fingerprint, ssh: {
      execCommand: async command => {
        try { return { ...await promisify(execFile)('/bin/bash', ['-c', command], { timeout: 30000, maxBuffer: 1024 * 1024 }), code: 0 }; }
        catch (error) { return { code: error.code, stdout: error.stdout || '', stderr: error.stderr || error.message }; }
      },
      putFile: async (from, to) => fs.copyFileSync(from, to), dispose() {},
    } };
  }
  const ssh = new NodeSSH();
  let fingerprint;
  const auth = decrypt(server.sshAuthEnc);
  try {
    await ssh.connect({ host: server.ip, port: server.sshPort, username: server.sshUser,
      readyTimeout: 12000, keepaliveInterval: 5000, hostHash: 'sha256',
      hostVerifier: hash => { fingerprint = hash; return !expected || hash === expected; },
      ...(server.sshAuthType === 'KEY' ? { privateKey: auth } : { password: auth }) });
    return { ssh, fingerprint };
  } catch (error) { ssh.dispose(); throw error; }
}
async function state(ssh) {
  return {
    arch: (await exec(ssh, 'uname -m')).trim(),
    agent: await exec(ssh, 'systemctl show nextpanel-agent -p ActiveState -p MainPID -p ExecStart; sha256sum /usr/local/bin/nextpanel-agent /etc/nextpanel/agent.json'),
    proxy: await exec(ssh, "for f in /etc/systemd/system/nextpanel-*.service; do [ -f \"$f\" ] || continue; case \"$f\" in *agent*) continue;; esac; systemctl show \"$(basename \"$f\")\" -p Id -p ActiveState -p MainPID -p NRestarts; sha256sum \"$f\"; done; find /etc/nextpanel/nodes -type f -print0 2>/dev/null | sort -z | xargs -0 -r sha256sum; for f in /usr/local/bin/xray /usr/local/bin/sing-box /usr/local/bin/v2ray; do [ ! -f \"$f\" ] || sha256sum \"$f\"; done"),
  };
}
async function main() {
  const servers = await prisma.server.findMany({ orderBy: { id: 'asc' } });
  if (mode === 'snapshot') {
    const subscriptions = await prisma.subscription.findMany({ select: { id: true, name: true, token: true, ownerId: true } });
    const shares = await prisma.subscriptionShare.findMany({ select: { id: true, subscriptionId: true, userId: true, shareToken: true } });
    const nodes = await prisma.node.findMany({ select: { id: true, name: true, serverId: true, protocol: true, status: true, lastReachable: true, lastTestedAt: true } });
    save('snapshot.json', { at: new Date(), subscriptions, shares, nodes, servers: servers.map(({sshAuthEnc,agentToken,...s}) => s) });
    console.log(JSON.stringify({ servers: servers.length, subscriptions: subscriptions.length, shares: shares.length, nodes: nodes.length }));
    return;
  }
  if (mode === 'status') {
    console.log(JSON.stringify(servers.map(s => ({ id: s.id, ip: s.ip, version: s.agentVersion, status: s.status, seen: s.lastSeenAt }))));
    return;
  }
  if (mode === 'probe') {
    const { CryptoService } = req(path.join(process.cwd(), 'dist/common/crypto/crypto.service.js'));
    const { XrayTestService } = req(path.join(process.cwd(), 'dist/nodes/xray-test/xray-test.service.js'));
    const { SingboxTestService } = req(path.join(process.cwd(), 'dist/nodes/singbox-test/singbox-test.service.js'));
    const service = new XrayTestService(prisma, new CryptoService({ getOrThrow: key => process.env[key] }), new SingboxTestService());
    const results = [];
    for (const node of await prisma.node.findMany({ where: { enabled: true }, select: { id: true, name: true } })) {
      const result = await service.testNode(node.id);
      results.push({ ...node, ...result });
      console.log(JSON.stringify(results.at(-1)));
    }
    save(`probe-${Date.now()}.json`, results);
    return;
  }
  const selected = serverId ? servers.filter(s => s.id === serverId) : servers;
  if (!selected.length) throw new Error('No matching server');
  for (const server of selected) {
    let ssh;
    try {
      const baseline = mode === 'audit' ? undefined : read(`audit-${server.id}.json`);
      const connection = await connect(server, baseline?.fingerprint);
      ssh = connection.ssh;
      if (mode === 'audit') {
        const cfg = JSON.parse(await exec(ssh, 'cat /etc/nextpanel/agent.json'));
        const entry = { id: server.id, ip: server.ip, at: new Date(), version: server.agentVersion, fingerprint: connection.fingerprint, endpoints: { server: cfg.serverUrl, direct: cfg.directUrl, tokenMatches: cfg.agentToken === server.agentToken }, ...await state(ssh) };
        save(`audit-${server.id}.json`, entry);
        console.log(JSON.stringify({ id: server.id, ip: server.ip, ok: true, arch: entry.arch }));
      } else if (mode === 'verify') {
        const current = await state(ssh);
        const unchanged = baseline.proxy === current.proxy;
        save(`verify-${server.id}.json`, { ...current, proxyUnchanged: unchanged });
        console.log(JSON.stringify({ id: server.id, proxyUnchanged: unchanged }));
        if (!unchanged) process.exitCode = 1;
      } else if (mode === 'upgrade' || mode === 'drill') {
        if (!serverId) throw new Error('Upgrade one explicit server at a time');
        const cfg = JSON.parse(await exec(ssh, 'cat /etc/nextpanel/agent.json'));
        if (cfg.agentToken !== server.agentToken) throw new Error('Agent belongs to another panel; do not overwrite its configuration');
        const before = await state(ssh);
        if (before.proxy !== baseline.proxy) throw new Error('Proxy baseline drift; review before upgrading');
        const arch = ({ x86_64: 'amd64', aarch64: 'arm64' })[before.arch];
        if (!arch) throw new Error('Unsupported architecture');
        const release = read('release.json');
        const asset = release.assets.find(a => a.name === `agent-linux-${arch}`);
        if (!/^sha256:[a-f0-9]{64}$/.test(asset?.digest ?? '')) throw new Error('Missing release digest');
        const binary = path.join(root, asset.name);
        if (crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex') !== asset.digest.slice(7)) throw new Error('Local artifact checksum mismatch');
        const dir = `/opt/backups/nextpanel-agent/release-${release.tag_name.replaceAll('/', '-').replaceAll('.', '-')}`;
        const remote = '/opt/backups/nextpanel-agent/candidate';
        await exec(ssh, 'mkdir -p -m 700 /opt/backups/nextpanel-agent');
        await ssh.putFile(binary, remote);
        await ssh.putFile(path.join(__dirname, 'agent-upgrade.sh'), '/opt/backups/nextpanel-agent/upgrade.sh');
        const started = new Date();
        await exec(ssh, `bash /opt/backups/nextpanel-agent/upgrade.sh upgrade ${q(dir)} ${q(remote)} ${q(asset.digest.slice(7))} ${q(release.tag_name.split('v').at(-1))}`);
        let healthy = false;
        for (let i = 0; i < 16; i++) {
          await delay(8000);
          const current = await prisma.server.findUnique({ where: { id: server.id } });
          if (current.agentVersion === release.tag_name.split('v').at(-1) && current.lastSeenAt > started) { healthy = true; break; }
        }
        const after = await state(ssh);
        if (!healthy || before.proxy !== after.proxy) {
          await exec(ssh, `bash ${q(dir + '/upgrade.sh')} rollback ${q(dir)}`);
          throw new Error('Heartbeat/proxy gate failed; restored previous agent');
        }
        if (mode === 'drill') {
          const rollbackStarted = new Date();
          await exec(ssh, `bash ${q(dir + '/upgrade.sh')} rollback ${q(dir)}`);
          let restored = false;
          for (let i = 0; i < 12; i++) {
            await delay(8000);
            const current = await prisma.server.findUnique({ where: { id: server.id } });
            if (current.agentVersion === baseline.version && current.lastSeenAt > rollbackStarted) { restored = true; break; }
          }
          const rolledBack = await state(ssh);
          if (!restored || before.proxy !== rolledBack.proxy) throw new Error('Rollback drill verification failed');
          await exec(ssh, `systemctl stop nextpanel-agent-ssh-rollback.timer; mv ${q(dir)} ${q(dir + '-drill')}`);
          save(`drill-${server.id}.json`, { id: server.id, from: baseline.version, to: release.tag_name, restored: true, proxyUnchanged: true, at: new Date() });
          console.log(JSON.stringify({ id: server.id, drill: 'upgrade-and-rollback-verified', proxyUnchanged: true }));
          continue;
        }
        await exec(ssh, `bash ${q(dir + '/upgrade.sh')} confirm ${q(dir)}`);
        save(`upgrade-${server.id}.json`, { id: server.id, version: release.tag_name, started, confirmed: new Date(), backup: dir, proxyUnchanged: true, ...after });
        console.log(JSON.stringify({ id: server.id, ip: server.ip, upgraded: release.tag_name, proxyUnchanged: true, backup: dir }));
      } else throw new Error('Unknown mode');
    } catch (error) {
      const result = { id: server.id, ip: server.ip, ok: false, error: error.message };
      save(`error-${mode}-${server.id}.json`, result);
      console.log(JSON.stringify(result));
      process.exitCode = 1;
    } finally { ssh?.dispose(); }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
