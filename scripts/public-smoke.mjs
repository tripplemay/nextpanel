// Subscription credentials are read from a private snapshot, never printed.
import fs from 'node:fs';
import crypto from 'node:crypto';
const [snapshotPath, outputPath, origin = 'https://vpn.vpanel.cc', oldPath] = process.argv.slice(2);
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
const checks = [
  { id: 'login', path: '/login', expected: 200 },
  { id: 'auth-boundary', path: '/api/servers', expected: 401 },
];
for (const s of snapshot.subscriptions) for (const format of ['', '/clash', '/singbox', '/homeproxy']) {
  checks.push({ id: `owner:${s.id}:${format || 'base64'}`, path: `/api/subscriptions/link/${s.token}${format}`, expected: 200 });
}
for (const s of snapshot.shares) for (const format of ['', '/clash', '/singbox']) {
  checks.push({ id: `share:${s.id}:${format || 'base64'}`, path: `/api/subscriptions/share/${s.shareToken}${format}`, expected: 200 });
}
if (oldPath) for (const s of JSON.parse(fs.readFileSync(oldPath, 'utf8')).subscriptions) {
  checks.push({ id: `revoked:${s.id}`, path: `/api/subscriptions/link/${s.token}`, expected: 404 });
}
const results = [];
for (const check of checks) {
  let result;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(origin + check.path, { redirect: 'error', signal: AbortSignal.timeout(20000) });
      const body = await response.text();
      let entries;
      if (response.ok && /singbox|homeproxy/.test(check.id)) entries = JSON.parse(body).outbounds?.length;
      if (response.ok && check.id.endsWith(':base64')) entries = Buffer.from(body, 'base64').toString().trim().split('\n').filter(Boolean).length;
      result = { id: check.id, status: response.status, ok: response.status === check.expected, bytes: Buffer.byteLength(body), sha256: crypto.createHash('sha256').update(body).digest('hex'), entries };
      if (result.ok) break;
    } catch (error) { result = { id: check.id, ok: false, error: error.cause?.code || error.name }; }
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  results.push(result);
  if (!result.ok) console.log(JSON.stringify(result));
}
fs.writeFileSync(outputPath, JSON.stringify({ at: new Date(), origin, results }, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ total: results.length, passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length }));
if (results.some(r => !r.ok)) process.exitCode = 1;
