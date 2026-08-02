import * as dgram from 'dgram';
import * as net from 'net';
import { probeSocks5Udp } from './socks5-udp-probe';

describe('SOCKS5 UDP probe', () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  it('completes a real UDP ASSOCIATE exchange and validates the DNS response', async () => {
    const udpRelay = dgram.createSocket('udp4');
    await bindUdp(udpRelay);
    closers.push(() => closeUdp(udpRelay));
    udpRelay.on('message', (message, remote) => {
      const dnsPayload = Buffer.from(message.subarray(10));
      dnsPayload[2] |= 0x80;
      const response = Buffer.concat([message.subarray(0, 10), dnsPayload]);
      udpRelay.send(response, remote.port, remote.address);
    });

    const relayPort = (udpRelay.address() as net.AddressInfo).port;
    const server = createSocksServer(relayPort, 0x00);
    const serverPort = await listenTcp(server);
    closers.push(() => closeTcp(server));

    await expect(probeSocks5Udp('127.0.0.1', serverPort, 2000)).resolves.toBeGreaterThanOrEqual(0);
  });

  it('rejects a proxy that refuses UDP ASSOCIATE', async () => {
    const server = createSocksServer(0, 0x07);
    const serverPort = await listenTcp(server);
    closers.push(() => closeTcp(server));

    await expect(probeSocks5Udp('127.0.0.1', serverPort, 1000)).rejects.toThrow(
      '不支持 UDP ASSOCIATE',
    );
  });
});

function createSocksServer(relayPort: number, associateStatus: number): net.Server {
  return net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let state: 'greeting' | 'associate' | 'done' = 'greeting';
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (state === 'greeting') {
        const messageLength = 2 + (buffer[1] ?? 0);
        if (buffer.length < messageLength) return;
        buffer = buffer.subarray(messageLength);
        socket.write(Buffer.from([0x05, 0x00]));
        state = 'associate';
      }
      if (state === 'associate' && buffer.length >= 10) {
        buffer = buffer.subarray(10);
        if (associateStatus === 0) {
          socket.write(Buffer.from([
            0x05, 0x00, 0x00, 0x01,
            0x7f, 0x00, 0x00, 0x01,
            (relayPort >> 8) & 0xff, relayPort & 0xff,
          ]));
        } else {
          socket.write(Buffer.from([0x05, associateStatus, 0x00, 0x01]));
        }
        state = 'done';
      }
    });
  });
}

function bindUdp(socket: dgram.Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(0, '127.0.0.1', () => {
      socket.off('error', reject);
      resolve();
    });
  });
}

function listenTcp(server: net.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve((server.address() as net.AddressInfo).port);
    });
  });
}

function closeUdp(socket: dgram.Socket): Promise<void> {
  return new Promise((resolve) => socket.close(() => resolve()));
}

function closeTcp(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
