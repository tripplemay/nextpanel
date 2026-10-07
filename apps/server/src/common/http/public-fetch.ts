import { lookup } from 'dns/promises';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { isIP } from 'net';
import { BadRequestException } from '@nestjs/common';

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) !== 6) return false;
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const [first, second = '0'] = canonical.split(':');
  const prefix = parseInt(first, 16);
  const subnet = parseInt(second, 16);
  // Only global unicast; exclude mapped IPv4, transition, documentation and special-use ranges.
  return prefix >= 0x2000 && prefix <= 0x3fff && prefix !== 0x2002 &&
    !(prefix === 0x2001 && (subnet < 0x200 || subnet === 0xdb8)) &&
    !(prefix === 0x3fff && subnet <= 0xfff);
}

export async function fetchPublicText(input: string, options: {
  maxBytes?: number; timeoutMs?: number; userAgent?: string;
} = {}): Promise<string> {
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  const deadline = Date.now() + (options.timeoutMs ?? 15_000);
  let url: URL;
  try { url = new URL(input); } catch { throw new BadRequestException('URL 无效'); }

  for (let redirects = 0; redirects <= 3; redirects++) {
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new BadRequestException('仅支持不含认证信息的 HTTP/HTTPS 订阅 URL');
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await beforeDeadline(lookup(hostname, { all: true, verbatim: true }), deadline);
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
      throw new BadRequestException('禁止访问非公网地址');
    }
    const pinned = addresses[0];
    const target = url;
    const result = await new Promise<{ text?: string; location?: string }>((resolve, reject) => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return reject(new BadRequestException('远程请求超时'));
      const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = transport(target, {
        agent: false,
        headers: { 'User-Agent': options.userAgent ?? 'NextPanel', 'Accept-Encoding': 'identity' },
        // Pin the validated resolution: the connection must not resolve the hostname again.
        lookup: (_host, opts, callback) => {
          if (opts.all) callback(null, [pinned]);
          else callback(null, pinned.address, pinned.family);
        },
      }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0) && res.headers.location) {
          res.resume();
          resolve({ location: res.headers.location });
          return;
        }
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          reject(new BadRequestException(`远程请求失败：HTTP ${res.statusCode}`));
          return;
        }
        if (Number(res.headers['content-length']) > maxBytes) {
          req.destroy(new BadRequestException('远程内容超出大小限制'));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) req.destroy(new BadRequestException('远程内容超出大小限制'));
          else chunks.push(chunk);
        });
        res.on('end', () => resolve({ text: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
        res.on('aborted', () => reject(new BadRequestException('远程响应中断')));
      });
      const timer = setTimeout(() => req.destroy(new BadRequestException('远程请求超时')), remaining);
      req.on('error', reject);
      req.on('close', () => clearTimeout(timer));
      req.end();
    });
    if (result.text !== undefined) return result.text;
    url = new URL(result.location!, target);
  }
  throw new BadRequestException('远程重定向次数过多');
}

async function beforeDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new BadRequestException('DNS 解析超时')), Math.max(0, deadline - Date.now()));
    })]);
  } finally { clearTimeout(timer!); }
}
