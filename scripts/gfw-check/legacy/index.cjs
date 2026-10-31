// Archived from Tencent SCF gfw-check, ap-guangzhou/default, 2026-10-31.
// Whitespace normalized. Reference only: do not deploy over the existing function.
const net = require('net');

exports.handler = async (event) => {
  const raw = event.body ?? event;
  const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const { ip, port = 443, timeout = 5000 } = body;

  const start = Date.now();
  const reachable = await tcpConnect(ip, port, timeout);
  const latency = Date.now() - start;
  return {
    statusCode: 200,
    body: JSON.stringify({ reachable, latency }),
  };
};

function tcpConnect(ip, port, timeout) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);
    socket.connect(port, ip, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}
