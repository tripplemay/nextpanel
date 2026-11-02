import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { waitForMihomoReady } from './mihomo-readiness.mjs';

async function fixture(t, handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return server.address().port;
}
const child = () => ({ exitCode: null, signalCode: null });

test('Mihomo readiness waits beyond listening until the loopback forwarding nonce arrives', async t => {
  let calls = 0;
  const port = await fixture(t, (req, res) => {
    assert.equal(req.url, 'http://127.0.0.1:12345/ready');
    res.statusCode = ++calls < 3 ? 502 : 200;
    res.end(calls < 3 ? 'initializing' : 'fixture-nonce');
  });
  await waitForMihomoReady(child(), port, 12345, 'fixture-nonce');
  assert.equal(calls, 3);
});
test('Mihomo readiness rejects a different listener identity without retrying the payload', async t => {
  let calls = 0;
  const port = await fixture(t, (_req, res) => { calls++; res.end('wrong-nonce'); });
  await assert.rejects(waitForMihomoReady(child(), port, 12345, 'fixture-nonce'), /identity mismatch/);
  assert.equal(calls, 1);
});
test('Mihomo readiness fails closed for exited children and bounded startup timeout', async t => {
  const port = await fixture(t, (_req, res) => { res.statusCode = 503; res.end(); });
  await assert.rejects(waitForMihomoReady({ exitCode: 0 }, port, 12345, 'fixture-nonce'), /exited/);
  await assert.rejects(waitForMihomoReady(child(), port, 12345, 'fixture-nonce', 80), /readiness timeout/);
});
