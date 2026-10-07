import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const require = createRequire(new URL('../../apps/server/package.json', import.meta.url));
require('ts-node').register({ project: fileURLToPath(new URL('../../apps/server/tsconfig.json', import.meta.url)), transpileOnly: true });
const { readSse } = require('../../apps/web/src/lib/sse-client.ts');
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function fixture(chunks, { close = true, error } = {}) {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
      if (error) controller.error(error);
      else if (close) controller.close();
    },
    cancel() { cancelled = true; },
  });
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer fixture-token');
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
  };
  return () => cancelled;
}
const read = (onEvent = () => {}, signal) => readSse('/fixture', 'fixture-token', onEvent, signal);

test('accepts a terminal success without waiting for socket EOF, dispatching once', async () => {
  const cancelled = fixture(['data: {"log":"hello"}\n\ndata: {"done":true,"success":true}\n\ndata: {"done":true,"success":false}\n\n'], { close: false });
  const events = [];
  assert.equal((await read(event => events.push(event))).outcome, 'success');
  assert.equal(events.length, 2);
  assert.equal(cancelled(), true);
});

test('preserves explicit business failure and batch terminal semantics', async () => {
  fixture(['data: {"done":true,"success":false}\n\n']);
  assert.equal((await read()).outcome, 'failed');
  fixture(['data: {"type":"done","total":0}\n\n']);
  assert.equal((await read()).outcome, 'success');
});

test('accepts CR-only frame boundaries at EOF', async () => {
  fixture(['data: {"done":true,"success":true}\r\r']);
  assert.equal((await read()).outcome, 'success');
});

test('handles UTF-8 fragmentation, CRLF, multiline data and keepalive comments', async () => {
  const bytes = new TextEncoder().encode(': keepalive\r\nid: 1\r\ndata: {"log":\r\ndata: "日志"}\r\n\r\ndata: {"done":true,"success":true}\r\n\r\n');
  fixture([...bytes].map(byte => new Uint8Array([byte])));
  const events = [];
  assert.equal((await read(event => events.push(event))).outcome, 'success');
  assert.equal(events[0].log, '日志');
});

for (const input of ['', 'data: {"log":"still running"}\n\n', 'data: {"done":true,"success":true}', 'data: {"done":true}\n\n', 'data: {bad}\n\n', 'data: null\n\n', 'data: []\n\n']) {
  test(`does not report success for incomplete/invalid stream: ${input}`, async () => {
    fixture([input]);
    assert.equal((await read()).outcome, 'interrupted');
  });
}

test('bounds unframed and framed event memory', async () => {
  for (const input of ['x'.repeat(1024 * 1024 + 1), `data: ${'x'.repeat(1024 * 1024 + 1)}\n\n`]) {
    fixture([input]);
    assert.match((await read()).error, /size limit/);
  }
});

test('does not swallow callback failures as JSON parse errors', async () => {
  fixture(['data: {"log":"x"}\n\ndata: {"done":true,"success":true}\n\n']);
  const result = await read(() => { throw new Error('consumer failure'); });
  assert.equal(result.outcome, 'interrupted');
  assert.match(result.error, /consumer failure/);
});

test('classifies HTTP, wrong content type and network failures', async () => {
  globalThis.fetch = async () => new Response('denied', { status: 401 });
  assert.deepEqual(await read(), { outcome: 'failed', status: 401 });
  globalThis.fetch = async () => new Response('<html>login</html>');
  assert.equal((await read()).outcome, 'interrupted');
  globalThis.fetch = async () => { throw new Error('offline'); };
  assert.equal((await read()).outcome, 'interrupted');
});

test('cancels pending reads and pre-aborted requests without a success event', async () => {
  const controller = new AbortController();
  const cancelled = fixture([], { close: false });
  const pending = read(() => assert.fail('no events'), controller.signal);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  assert.deepEqual(await pending, { outcome: 'cancelled' });
  assert.equal(cancelled(), true);
  globalThis.fetch = () => assert.fail('pre-aborted request must not fetch');
  assert.deepEqual(await read(undefined, controller.signal), { outcome: 'cancelled' });
});

test('real HTTP chunked EOF without done is interrupted', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"log":"started"}\n\n');
    res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await readSse(`http://127.0.0.1:${server.address().port}`, '', () => {});
    assert.equal(result.outcome, 'interrupted');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
