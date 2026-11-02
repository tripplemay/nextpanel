import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

export async function waitForMihomoReady(child, proxyPort, targetPort, nonce, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode != null || child.signalCode != null) throw new Error('Mihomo exited before forwarding readiness');
    const result = await new Promise(resolve => {
      const request = http.get({ host: '127.0.0.1', port: proxyPort, agent: false,
        path: `http://127.0.0.1:${targetPort}/ready`, timeout: Math.min(250, Math.max(1, deadline - Date.now())),
        headers: { Host: `127.0.0.1:${targetPort}` } }, response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; if (body.length > 1024) request.destroy(); });
        response.once('end', () => resolve({ status: response.statusCode, body }));
        response.once('error', () => resolve(null));
      });
      request.once('timeout', () => request.destroy());
      request.once('error', () => resolve(null));
    });
    if (child.exitCode != null || child.signalCode != null) throw new Error('Mihomo exited before forwarding readiness');
    if (result?.status === 200) {
      if (result.body !== nonce) throw new Error('Mihomo readiness response identity mismatch');
      return;
    }
    if (result && ![502, 503].includes(result.status)) throw new Error(`Unexpected readiness status ${result.status}`);
    await delay(25);
  }
  throw new Error('Mihomo forwarding readiness timeout');
}
