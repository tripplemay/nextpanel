import * as crypto from 'crypto';
import * as dgram from 'dgram';
import * as net from 'net';

const PROBE_TIMEOUT_MS = 8000;
const DNS_TARGET = '1.1.1.1';
const DNS_PORT = 53;

export async function probeSocks5Udp(
  host: string,
  port: number,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<number> {
  const startedAt = Date.now();
  const tcp = net.createConnection({ host, port });
  const reader = new SocketReader(tcp);
  let udp: dgram.Socket | null = null;

  try {
    await waitForConnect(tcp, timeoutMs);
    tcp.write(Buffer.from([0x05, 0x01, 0x00]));
    const greeting = await reader.read(2, timeoutMs);
    if (greeting[0] !== 0x05 || greeting[1] !== 0x00) {
      throw new Error('SOCKS5 UDP 探测握手失败');
    }

    tcp.write(Buffer.from([0x05, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
    const replyHeader = await reader.read(4, timeoutMs);
    if (replyHeader[0] !== 0x05 || replyHeader[1] !== 0x00) {
      throw new Error(`SOCKS5 上游不支持 UDP ASSOCIATE（状态 ${replyHeader[1] ?? 'unknown'}）`);
    }
    const relayHost = await readAddress(reader, replyHeader[3], timeoutMs);
    const relayPort = (await reader.read(2, timeoutMs)).readUInt16BE(0);
    const normalizedRelayHost = isUnspecifiedAddress(relayHost)
      ? normalizeRemoteAddress(tcp.remoteAddress)
      : relayHost;

    udp = dgram.createSocket(net.isIP(normalizedRelayHost) === 6 ? 'udp6' : 'udp4');
    const transactionId = crypto.randomBytes(2);
    const dnsQuery = buildDnsQuery(transactionId);
    const packet = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, DNS_PORT]),
      dnsQuery,
    ]);
    const response = await sendAndReceive(udp, packet, normalizedRelayHost, relayPort, timeoutMs);
    const payload = extractUdpPayload(response);
    if (
      payload.length < 12
      || !payload.subarray(0, 2).equals(transactionId)
      || (payload[2] & 0x80) === 0
    ) {
      throw new Error('SOCKS5 UDP 探测收到无效 DNS 响应');
    }
    return Date.now() - startedAt;
  } finally {
    reader.dispose();
    tcp.destroy();
    udp?.close();
  }
}

class SocketReader {
  private buffer = Buffer.alloc(0);
  private pending: {
    size: number;
    resolve: (value: Buffer) => void;
    reject: (reason: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;
  private readonly onData = (chunk: Buffer) => {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.flush();
  };
  private readonly onError = (err: Error) => this.fail(err);
  private readonly onClose = () => this.fail(new Error('SOCKS5 UDP 探测连接提前关闭'));

  constructor(private readonly socket: net.Socket) {
    socket.on('data', this.onData);
    socket.on('error', this.onError);
    socket.on('close', this.onClose);
  }

  read(size: number, timeoutMs: number): Promise<Buffer> {
    if (this.pending) throw new Error('Concurrent SOCKS5 reads are not supported');
    if (this.buffer.length >= size) return Promise.resolve(this.take(size));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error('SOCKS5 UDP 探测响应超时'));
      }, timeoutMs);
      this.pending = { size, resolve, reject, timer };
    });
  }

  dispose(): void {
    this.socket.off('data', this.onData);
    this.socket.off('error', this.onError);
    this.socket.off('close', this.onClose);
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending = null;
    }
  }

  private flush(): void {
    if (!this.pending || this.buffer.length < this.pending.size) return;
    const pending = this.pending;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.resolve(this.take(pending.size));
  }

  private take(size: number): Buffer {
    const value = this.buffer.subarray(0, size);
    this.buffer = this.buffer.subarray(size);
    return value;
  }

  private fail(err: Error): void {
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.reject(err);
  }
}

function waitForConnect(socket: net.Socket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('SOCKS5 UDP 探测连接超时'));
    }, timeoutMs);
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (err: Error) => {
      cleanup();
      reject(new Error(`SOCKS5 UDP 探测连接失败：${err.message}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('error', onError);
    };
    socket.once('connect', onConnect);
    socket.once('error', onError);
  });
}

async function readAddress(
  reader: SocketReader,
  addressType: number,
  timeoutMs: number,
): Promise<string> {
  if (addressType === 0x01) {
    return Array.from(await reader.read(4, timeoutMs)).join('.');
  }
  if (addressType === 0x03) {
    const length = (await reader.read(1, timeoutMs))[0];
    return (await reader.read(length, timeoutMs)).toString('utf8');
  }
  if (addressType === 0x04) {
    const bytes = await reader.read(16, timeoutMs);
    const groups: string[] = [];
    for (let i = 0; i < bytes.length; i += 2) groups.push(bytes.readUInt16BE(i).toString(16));
    return groups.join(':');
  }
  throw new Error(`SOCKS5 UDP 探测返回未知地址类型 ${addressType}`);
}

function sendAndReceive(
  socket: dgram.Socket,
  packet: Buffer,
  host: string,
  port: number,
  timeoutMs: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('SOCKS5 UDP ASSOCIATE 无响应'));
    }, timeoutMs);
    const onMessage = (message: Buffer) => {
      cleanup();
      resolve(message);
    };
    const onError = (err: Error) => {
      cleanup();
      reject(new Error(`SOCKS5 UDP ASSOCIATE 失败：${err.message}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('message', onMessage);
      socket.off('error', onError);
    };
    socket.once('message', onMessage);
    socket.once('error', onError);
    socket.send(packet, port, host, (err) => {
      if (err) onError(err);
    });
  });
}

function extractUdpPayload(packet: Buffer): Buffer {
  if (packet.length < 10 || packet[0] !== 0 || packet[1] !== 0 || packet[2] !== 0) {
    throw new Error('SOCKS5 UDP 响应头无效');
  }
  const addressType = packet[3];
  let offset: number;
  if (addressType === 0x01) offset = 4 + 4 + 2;
  else if (addressType === 0x04) offset = 4 + 16 + 2;
  else if (addressType === 0x03) offset = 4 + 1 + (packet[4] ?? 0) + 2;
  else throw new Error('SOCKS5 UDP 响应地址类型无效');
  if (packet.length <= offset) throw new Error('SOCKS5 UDP 响应为空');
  return packet.subarray(offset);
}

function buildDnsQuery(transactionId: Buffer): Buffer {
  return Buffer.concat([
    transactionId,
    Buffer.from([
      0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x07, 0x65, 0x78, 0x61, 0x6d, 0x70, 0x6c, 0x65,
      0x03, 0x63, 0x6f, 0x6d, 0x00,
      0x00, 0x01, 0x00, 0x01,
    ]),
  ]);
}

function isUnspecifiedAddress(address: string): boolean {
  return address === '0.0.0.0' || address === '::' || /^0(?::0){7}$/.test(address);
}

function normalizeRemoteAddress(address?: string): string {
  if (!address) return '127.0.0.1';
  return address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
}
